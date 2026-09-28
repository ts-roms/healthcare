import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, NotFoundError } from "@healthcare/core";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createAllergySchema } from "../clinic.dto";
import { EXTERNAL_HISTORY_KINDS, externalHistoryEntry, type ExternalHistoryRecord } from "../clinic.schema";
import { found, publicView } from "../clinic-support";
import { TriageService } from "../triage/triage.service";

/** Where an imported record came from: the import reference and the source as the sender declared it. */
export interface ExternalRecordOrigin {
  /** e.g. "fhir-import:<import id>#<entry index>" */
  reference: string;
  declaredSource: string | null;
}

const optional = (max: number) => z.string().trim().min(1).max(max).nullable();

/** External history as the clinic records it (the interoperability layer maps imported resources to this). */
export const externalHistoryInputSchema = z.object({
  kind: z.enum(EXTERNAL_HISTORY_KINDS),
  category: optional(200),
  display: z.string().trim().min(1).max(500),
  codeSystem: optional(200),
  code: optional(60),
  valueText: optional(500),
  statusText: optional(120),
  effectiveText: optional(60),
});
export type ExternalHistoryInput = z.infer<typeof externalHistoryInputSchema>;

/** An allergy from an import: the staff entry's own validation applies; it is always recorded unconfirmed. */
export const importedAllergySchema = createAllergySchema.omit({ verification: true });
export type ImportedAllergyRecordInput = z.input<typeof importedAllergySchema>;

export type ExternalHistoryView = Omit<ExternalHistoryRecord, "organizationId">;

function validated<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BusinessRuleError(
      "The imported entry cannot be recorded as it is",
      "invalid_import_entry",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}

/**
 * Records that came from outside the platform, accepted by staff from an import (libs/interoperability reaches this
 * through a port wired in apps/api). Allergies go through the same command as a staff entry (unconfirmed, with the
 * source); everything the clinic cannot take as its own clinical record is kept as external history, clearly labelled.
 */
@Injectable()
export class ExternalRecordsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly triage: TriageService,
  ) {}

  /** In the caller's transaction. Throws allergy_exists when the substance is already an active allergy (nothing is overwritten). */
  recordImportedAllergy(tx: DbExecutor, actor: Actor, patientId: string, input: ImportedAllergyRecordInput, origin: ExternalRecordOrigin) {
    const allergy = validated(importedAllergySchema, input);
    return this.triage.addAllergyIn(tx, actor, patientId, { ...allergy, verification: "unconfirmed" }, { reference: origin.reference });
  }

  /** In the caller's transaction. */
  async recordExternalHistory(
    tx: DbExecutor,
    actor: Actor,
    patientId: string,
    input: ExternalHistoryInput,
    origin: ExternalRecordOrigin,
  ): Promise<ExternalHistoryView> {
    const entry = validated(externalHistoryInputSchema, input);
    const [created] = await tx
      .insert(externalHistoryEntry)
      .values({
        ...entry,
        organizationId: actor.organizationId,
        patientId,
        sourceReference: origin.reference,
        declaredSource: origin.declaredSource,
        recordedBy: actor.userId,
      })
      .returning();
    const row = found(created, "External history entry");
    await this.audit.record(tx, actor, {
      action: "external-history.record",
      resourceType: "external_history_entry",
      resourceId: row.id,
      patientId,
      metadata: { kind: row.kind, sourceReference: origin.reference },
    });
    return publicView(row);
  }

  /** The patient's external history, newest first (entries in error included, marked). */
  async list(actor: Actor, patientId: string): Promise<ExternalHistoryView[]> {
    const rows = await this.db
      .select()
      .from(externalHistoryEntry)
      .where(and(eq(externalHistoryEntry.organizationId, actor.organizationId), eq(externalHistoryEntry.patientId, patientId)))
      .orderBy(desc(externalHistoryEntry.recordedAt))
      .limit(500);
    await this.audit.recordStandalone(actor, {
      action: "external-history.view",
      resourceType: "external_history_entry",
      patientId,
      metadata: { count: rows.length },
    });
    return rows.map(publicView);
  }

  async markEnteredInError(actor: Actor, patientId: string, entryId: string, reason: string): Promise<ExternalHistoryView> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(externalHistoryEntry)
        .where(
          and(
            eq(externalHistoryEntry.organizationId, actor.organizationId),
            eq(externalHistoryEntry.patientId, patientId),
            eq(externalHistoryEntry.id, entryId),
          ),
        )
        .for("update");
      if (!current) throw new NotFoundError("External history entry");
      if (current.status !== "active") throw new BusinessRuleError("The entry is already marked entered in error", "already_entered_in_error");
      const [updated] = await tx
        .update(externalHistoryEntry)
        .set({ status: "entered_in_error", enteredInErrorReason: reason, enteredInErrorBy: actor.userId, enteredInErrorAt: new Date() })
        .where(eq(externalHistoryEntry.id, entryId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "external-history.entered-in-error",
        resourceType: "external_history_entry",
        resourceId: entryId,
        patientId,
        reason,
        changes: { status: { from: "active", to: "entered_in_error" } },
      });
      return publicView(found(updated, "External history entry"));
    });
  }
}
