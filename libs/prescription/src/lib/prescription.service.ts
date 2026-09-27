import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  ForbiddenError,
  NotFoundError,
} from "@healthcare/core";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { checkAllergies } from "./allergy-check";
import type { cancelPrescriptionSchema, issuePrescriptionSchema, PrescriptionItemInput, replacePrescriptionSchema } from "./prescription.dto";
import {
  type AllergyWarning,
  prescription,
  prescriptionItem,
  type PrescriptionItemRecord,
  prescriptionNumberSequence,
  type PrescriptionRecord,
} from "./prescription.schema";
import { PRESCRIBING_CONTEXT, type PrescribingContext } from "./ports";

/** Professions allowed to issue prescriptions on this platform. */
const PRESCRIBING_PROFESSIONS = new Set(["physician", "dentist"]);

export interface PrescriptionView extends Omit<PrescriptionRecord, "organizationId"> {
  items: Array<Omit<PrescriptionItemRecord, "prescriptionId">>;
}

/**
 * Prescriptions are immutable once issued (enforced by database triggers).
 * Changes are made by cancelling, or by replacing (the old one becomes
 * "superseded" and points forward to the new one).
 */
@Injectable()
export class PrescriptionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PRESCRIBING_CONTEXT) private readonly context: PrescribingContext,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  async issue(actor: Actor, input: z.infer<typeof issuePrescriptionSchema>): Promise<PrescriptionView> {
    const prescriber = await this.requirePrescriber(actor);
    const encounter = await this.context.encounter(actor.organizationId, input.encounterId);
    if (!encounter) throw new NotFoundError("Encounter");
    if (encounter.status !== "in_progress") {
      throw new BusinessRuleError("Prescriptions are issued during an open encounter; replace an existing one to correct it", "encounter_not_in_progress");
    }
    const warnings = await this.allergyWarnings(actor.organizationId, encounter.patientId, input.items, input.allergyOverrideReason);
    return this.db.transaction(async (tx) => {
      const created = await this.insert(tx, actor, {
        facilityId: encounter.facilityId,
        patientId: encounter.patientId,
        encounterId: encounter.id,
        prescriberId: prescriber.id,
        items: input.items,
        notes: input.notes,
        warnings,
        overrideReason: input.allergyOverrideReason,
      });
      await this.audit.record(tx, actor, {
        action: "prescription.issue",
        resourceType: "prescription",
        resourceId: created.id,
        patientId: created.patientId,
        reason: warnings.length ? input.allergyOverrideReason : undefined,
        metadata: {
          prescriptionNumber: created.prescriptionNumber,
          encounterId: created.encounterId,
          items: input.items.length,
          allergyWarnings: warnings.length,
        },
      });
      if (warnings.length) {
        // Overrides of decision support are logged separately so they can be reviewed.
        await this.audit.record(tx, actor, {
          action: "decision-support.override",
          resourceType: "prescription",
          resourceId: created.id,
          patientId: created.patientId,
          reason: input.allergyOverrideReason,
          metadata: { rule: "drug-allergy-name-match", warnings },
        });
      }
      await this.events.record(tx, prescriptionEvent("PrescriptionIssued", created));
      return this.view(tx, created);
    });
  }

  async replace(actor: Actor, prescriptionId: string, input: z.infer<typeof replacePrescriptionSchema>): Promise<PrescriptionView> {
    const prescriber = await this.requirePrescriber(actor);
    const current = await this.find(this.db, actor.organizationId, prescriptionId);
    if (current.status !== "active") throw new BusinessRuleError(`The prescription is ${current.status}`, "prescription_not_active");
    const encounter = await this.context.encounter(actor.organizationId, current.encounterId);
    if (!encounter || encounter.status === "entered_in_error") throw new BusinessRuleError("The encounter is no longer valid", "encounter_invalid");
    const warnings = await this.allergyWarnings(actor.organizationId, current.patientId, input.items, input.allergyOverrideReason);
    return this.db.transaction(async (tx) => {
      const superseded = await this.close(tx, actor, current, "superseded", input.reason);
      const created = await this.insert(tx, actor, {
        facilityId: current.facilityId,
        patientId: current.patientId,
        encounterId: current.encounterId,
        prescriberId: prescriber.id,
        items: input.items,
        notes: input.notes,
        warnings,
        overrideReason: input.allergyOverrideReason,
        replaces: current.id,
      });
      await this.audit.record(tx, actor, {
        action: "prescription.replace",
        resourceType: "prescription",
        resourceId: created.id,
        patientId: created.patientId,
        reason: input.reason,
        metadata: { replaces: current.prescriptionNumber, prescriptionNumber: created.prescriptionNumber, allergyWarnings: warnings.length },
      });
      await this.events.record(
        tx,
        prescriptionEvent("PrescriptionCancelled", superseded, { replacedBy: created.id }),
        prescriptionEvent("PrescriptionIssued", created, { replaces: current.id }),
      );
      return this.view(tx, created);
    });
  }

  async cancel(actor: Actor, prescriptionId: string, input: z.infer<typeof cancelPrescriptionSchema>): Promise<PrescriptionView> {
    return this.db.transaction(async (tx) => {
      const current = await this.find(tx, actor.organizationId, prescriptionId);
      if (current.status !== "active") throw new BusinessRuleError(`The prescription is ${current.status}`, "prescription_not_active");
      const cancelled = await this.close(tx, actor, current, "cancelled", input.reason);
      await this.audit.record(tx, actor, {
        action: "prescription.cancel",
        resourceType: "prescription",
        resourceId: prescriptionId,
        patientId: current.patientId,
        reason: input.reason,
      });
      await this.events.record(tx, prescriptionEvent("PrescriptionCancelled", cancelled));
      return this.view(tx, cancelled);
    });
  }

  async get(actor: Actor, prescriptionId: string): Promise<PrescriptionView> {
    const row = await this.find(this.db, actor.organizationId, prescriptionId);
    await this.audit.recordStandalone(actor, {
      action: "prescription.view",
      resourceType: "prescription",
      resourceId: prescriptionId,
      patientId: row.patientId,
    });
    return this.view(this.db, row);
  }

  async list(actor: Actor, query: { patientId?: string; encounterId?: string; activeOnly?: boolean }): Promise<PrescriptionView[]> {
    const filters: SQL[] = [eq(prescription.organizationId, actor.organizationId)];
    if (query.patientId) filters.push(eq(prescription.patientId, query.patientId));
    if (query.encounterId) filters.push(eq(prescription.encounterId, query.encounterId));
    if (query.activeOnly) filters.push(eq(prescription.status, "active"));
    const rows = await this.db
      .select()
      .from(prescription)
      .where(and(...filters))
      .orderBy(desc(prescription.issuedAt))
      .limit(200);
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    for (const patientId of patientIds) {
      await this.audit.recordStandalone(actor, { action: "prescription.list", resourceType: "prescription", patientId });
    }
    return this.views(this.db, rows);
  }

  /** Active prescriptions, for Patient 360. Not audited here; the caller audits. */
  async activeForPatient(organizationId: string, patientId: string): Promise<PrescriptionView[]> {
    const rows = await this.db
      .select()
      .from(prescription)
      .where(and(eq(prescription.organizationId, organizationId), eq(prescription.patientId, patientId), eq(prescription.status, "active")))
      .orderBy(desc(prescription.issuedAt))
      .limit(20);
    return this.views(this.db, rows);
  }

  // ---- internals -----------------------------------------------------------------

  private async requirePrescriber(actor: Actor) {
    const prescriber = await this.context.prescriber(actor.organizationId, actor.userId);
    if (!prescriber || !PRESCRIBING_PROFESSIONS.has(prescriber.profession)) {
      throw new ForbiddenError("Your account is not linked to a practitioner who may prescribe");
    }
    return prescriber;
  }

  private async allergyWarnings(
    organizationId: string,
    patientId: string,
    items: PrescriptionItemInput[],
    overrideReason: string | undefined,
  ): Promise<AllergyWarning[]> {
    const allergies = await this.context.allergies(organizationId, patientId);
    const warnings = checkAllergies(items, allergies);
    if (warnings.length > 0 && !overrideReason) {
      throw new ConflictError(
        "Decision support: a prescribed medicine matches a recorded allergy. Review, then resubmit with allergyOverrideReason to proceed.",
        { warnings, allergyStatus: allergies.status, decisionSupport: true },
        "allergy_warning",
      );
    }
    return warnings;
  }

  private async insert(
    tx: DbExecutor,
    actor: Actor,
    values: {
      facilityId: string;
      patientId: string;
      encounterId: string;
      prescriberId: string;
      items: PrescriptionItemInput[];
      notes?: string;
      warnings: AllergyWarning[];
      overrideReason?: string;
      replaces?: string;
    },
  ): Promise<PrescriptionRecord> {
    const [counter] = await tx
      .insert(prescriptionNumberSequence)
      .values({ organizationId: actor.organizationId, nextValue: 1 })
      .onConflictDoUpdate({ target: prescriptionNumberSequence.organizationId, set: { nextValue: sql`${prescriptionNumberSequence.nextValue} + 1` } })
      .returning({ value: prescriptionNumberSequence.nextValue });
    if (!counter) throw new Error("Could not allocate a prescription number");
    const [created] = await tx
      .insert(prescription)
      .values({
        organizationId: actor.organizationId,
        facilityId: values.facilityId,
        patientId: values.patientId,
        encounterId: values.encounterId,
        prescriberPractitionerId: values.prescriberId,
        prescriptionNumber: `RX${String(counter.value).padStart(8, "0")}`,
        issuedBy: actor.userId,
        notes: values.notes ?? null,
        replacesPrescriptionId: values.replaces ?? null,
        allergyWarnings: values.warnings,
        allergyOverrideReason: values.warnings.length ? (values.overrideReason ?? null) : null,
      })
      .returning();
    if (!created) throw new Error("Prescription insert returned no row");
    await tx.insert(prescriptionItem).values(
      values.items.map((item, index) => ({
        ...item,
        prescriptionId: created.id,
        lineNumber: index + 1,
        brandName: item.brandName ?? null,
      })),
    );
    return created;
  }

  private async close(
    tx: DbExecutor,
    actor: Actor,
    current: PrescriptionRecord,
    status: "cancelled" | "superseded",
    reason: string,
  ): Promise<PrescriptionRecord> {
    const [updated] = await tx
      .update(prescription)
      .set({ status, cancelledAt: new Date(), cancelledBy: actor.userId, cancellationReason: reason })
      .where(and(eq(prescription.id, current.id), eq(prescription.status, "active")))
      .returning();
    if (!updated) throw new ConflictError("The prescription was changed by someone else", undefined, "prescription_not_active");
    return updated;
  }

  private async find(executor: DbExecutor, organizationId: string, prescriptionId: string): Promise<PrescriptionRecord> {
    const [row] = await executor
      .select()
      .from(prescription)
      .where(and(eq(prescription.organizationId, organizationId), eq(prescription.id, prescriptionId)));
    if (!row) throw new NotFoundError("Prescription");
    return row;
  }

  private async view(executor: DbExecutor, row: PrescriptionRecord): Promise<PrescriptionView> {
    const [result] = await this.views(executor, [row]);
    return result!;
  }

  private async views(executor: DbExecutor, rows: PrescriptionRecord[]): Promise<PrescriptionView[]> {
    if (rows.length === 0) return [];
    const items = await executor
      .select()
      .from(prescriptionItem)
      .where(
        inArray(
          prescriptionItem.prescriptionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(prescriptionItem.lineNumber));
    return rows.map(({ organizationId: _org, ...row }) => ({
      ...row,
      items: items.filter((i) => i.prescriptionId === row.id).map(({ prescriptionId: _p, ...item }) => item),
    }));
  }
}

function prescriptionEvent(type: string, row: PrescriptionRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "prescription",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: { encounterId: row.encounterId, prescriptionNumber: row.prescriptionNumber, status: row.status, ...extra },
  };
}
