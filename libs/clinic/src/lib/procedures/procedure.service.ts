import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  filedAsPatient,
  ForbiddenError,
  localDate,
  NotFoundError,
  PgErrorCode,
  requireFacilityId,
  timelineFacility,
  timelineInstant,
  timelineRange,
  type TimelineWindow,
  VersionConflictError,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { encounter, practitioner } from "../clinic.schema";
import { found } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import type { createProcedureDefinitionSchema, recordProcedureSchema, updateProcedureDefinitionSchema } from "./procedure.dto";
import { performedAtProblem, procedureText, recordingProblem } from "./procedure.rules";
import { type ClinicProcedureRecord, clinicProcedure, clinicProcedureDefinition, type ProcedureDefinitionRecord } from "./procedure.schema";
import { PROCEDURE_STAFF_NAMES, type ProcedureStaffNames } from "./ports";

export type ProcedureDefinitionView = Omit<ProcedureDefinitionRecord, "organizationId">;

/** One procedure as staff see it (staff notes included). */
export interface ClinicProcedureView {
  id: string;
  /** The record it is filed under (the patient, or a record merged into it). */
  patientId: string;
  facility: { id: string; name: string };
  encounterId: string;
  definitionId: string;
  code: string;
  name: string;
  codeSystem: string | null;
  externalCode: string | null;
  /** "Suture repair × 2 (left forearm)". */
  description: string;
  performedAt: string;
  performer: { id: string; name: string };
  bodySite: string | null;
  quantity: number;
  notes: string | null;
  lateEntryReason: string | null;
  enteredInError: { at: string; reason: string; byName: string | null } | null;
  recordedAt: string;
  recordedBy: string;
  recordedByName: string | null;
}

const PROBLEM_MESSAGE: Record<string, string> = {
  encounter_entered_in_error: "The consultation is marked entered in error",
  encounter_online: "Procedures are recorded in an in-person consultation",
  amendment_permission_required: "The consultation is signed; recording a procedure now needs permission to amend it",
  late_entry_reason_required: "The consultation is signed; say why the procedure is recorded now",
  performed_in_future: "The time given is in the future",
  performed_before_encounter: "The time given is before the consultation began",
};

/**
 * Procedures performed at the clinic (docs/domains/clinic.md, "Procedures"): the organization's own catalogue, and
 * procedures recorded in an in-person consultation with who performed them. Immutable: a mistake is marked entered in
 * error (billing cancels its charge if not yet invoiced). Nothing decides whether a procedure was indicated.
 */
@Injectable()
export class ClinicProcedureService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly config: ClinicConfigService,
    private readonly organizations: OrganizationService,
    @Inject(PROCEDURE_STAFF_NAMES) private readonly staff: ProcedureStaffNames,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  // ---- catalogue ------------------------------------------------------------------------------------------------

  async listDefinitions(actor: Actor, includeInactive = false): Promise<ProcedureDefinitionView[]> {
    const rows = await this.db
      .select()
      .from(clinicProcedureDefinition)
      .where(
        and(eq(clinicProcedureDefinition.organizationId, actor.organizationId), includeInactive ? undefined : eq(clinicProcedureDefinition.status, "active")),
      )
      .orderBy(asc(clinicProcedureDefinition.status), asc(clinicProcedureDefinition.name));
    return rows.map(definitionView);
  }

  async createDefinition(actor: Actor, input: z.output<typeof createProcedureDefinitionSchema>): Promise<ProcedureDefinitionView> {
    return this.unique(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(clinicProcedureDefinition)
          .values({
            organizationId: actor.organizationId,
            code: input.code,
            name: input.name,
            codeSystem: input.externalCode ? (input.codeSystem ?? null) : null,
            externalCode: input.externalCode ?? null,
            requiresBodySite: input.requiresBodySite,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })
          .returning();
        const created = found(row, "Procedure");
        await this.audit.record(tx, actor, {
          action: "clinic.procedure-catalog.create",
          resourceType: "clinic_procedure_definition",
          resourceId: created.id,
          metadata: { code: created.code, name: created.name },
        });
        return definitionView(created);
      }),
    );
  }

  async updateDefinition(actor: Actor, definitionId: string, input: z.output<typeof updateProcedureDefinitionSchema>): Promise<ProcedureDefinitionView> {
    return this.unique(() =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(clinicProcedureDefinition)
          .where(and(eq(clinicProcedureDefinition.organizationId, actor.organizationId), eq(clinicProcedureDefinition.id, definitionId)))
          .for("update");
        const before = found(current, "Procedure");
        if (before.version !== input.version) throw new VersionConflictError("Procedure", input.version);
        const externalCode = input.externalCode === undefined ? before.externalCode : input.externalCode;
        const codeSystem = externalCode ? ((input.codeSystem === undefined ? before.codeSystem : input.codeSystem) ?? null) : null;
        if (externalCode && !codeSystem) throw new BusinessRuleError("Give the code with its code system", "code_system_required");
        const changes = {
          name: input.name ?? before.name,
          codeSystem,
          externalCode,
          requiresBodySite: input.requiresBodySite ?? before.requiresBodySite,
          status: input.status ?? before.status,
        };
        const [row] = await tx
          .update(clinicProcedureDefinition)
          .set({ ...changes, updatedBy: actor.userId, updatedAt: new Date(), version: before.version + 1 })
          .where(eq(clinicProcedureDefinition.id, definitionId))
          .returning();
        const changed = Object.fromEntries(
          Object.entries(changes)
            .filter(([k, v]) => v !== before[k as keyof typeof changes])
            .map(([k, v]) => [k, { from: before[k as keyof typeof changes], to: v }]),
        );
        await this.audit.record(tx, actor, {
          action: "clinic.procedure-catalog.update",
          resourceType: "clinic_procedure_definition",
          resourceId: definitionId,
          changes: changed,
        });
        return definitionView(found(row, "Procedure"));
      }),
    );
  }

  // ---- recording --------------------------------------------------------------------------------------------------

  /** Records a procedure performed in the consultation (at the selected facility). */
  async record(actor: Actor, encounterId: string, input: z.output<typeof recordProcedureSchema>): Promise<ClinicProcedureView> {
    const facilityId = requireFacilityId(actor);
    const now = new Date();
    const performedAt = input.performedAt ? new Date(input.performedAt) : now;
    const own = input.performerPractitionerId ? null : await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const performerId = input.performerPractitionerId ?? own?.id;
    if (!performerId) throw new BusinessRuleError("Choose who performed the procedure", "performer_required");

    const row = await this.db.transaction(async (tx) => {
      const [consultation] = await tx
        .select()
        .from(encounter)
        .where(and(eq(encounter.organizationId, actor.organizationId), eq(encounter.id, encounterId)))
        .for("share");
      const current = found(consultation, "Encounter");
      if (current.facilityId !== facilityId) throw new BusinessRuleError("The consultation is at another facility", "encounter_other_facility");
      const problem =
        recordingProblem(current, { canAmend: actor.permissions.has("encounter.amend") }, input.lateEntryReason) ??
        performedAtProblem(performedAt, current.startedAt, now);
      if (problem === "amendment_permission_required") throw new ForbiddenError(PROBLEM_MESSAGE[problem]!);
      if (problem) throw new BusinessRuleError(PROBLEM_MESSAGE[problem]!, problem);
      const [definition] = await tx
        .select()
        .from(clinicProcedureDefinition)
        .where(and(eq(clinicProcedureDefinition.organizationId, actor.organizationId), eq(clinicProcedureDefinition.id, input.definitionId)));
      const procedure = found(definition, "Procedure");
      if (procedure.status !== "active") throw new BusinessRuleError(`${procedure.name} is no longer in the catalogue`, "procedure_inactive");
      if (procedure.requiresBodySite && !input.bodySite) throw new BusinessRuleError(`Say where ${procedure.name} was done`, "body_site_required");
      const [performer] = await tx
        .select({ id: practitioner.id, status: practitioner.status })
        .from(practitioner)
        .where(and(eq(practitioner.organizationId, actor.organizationId), eq(practitioner.id, performerId)));
      if (!performer || performer.status !== "active")
        throw new BusinessRuleError("Choose an active practitioner of your organization", "practitioner_inactive");

      const [inserted] = await tx
        .insert(clinicProcedure)
        .values({
          organizationId: actor.organizationId,
          patientId: current.patientId,
          facilityId,
          encounterId,
          definitionId: procedure.id,
          code: procedure.code,
          name: procedure.name,
          codeSystem: procedure.codeSystem,
          externalCode: procedure.externalCode,
          performedAt,
          performerPractitionerId: performer.id,
          bodySite: input.bodySite ?? null,
          quantity: input.quantity,
          notes: input.notes ?? null,
          lateEntryReason: current.status === "completed" ? (input.lateEntryReason ?? null) : null,
          recordedBy: actor.userId,
        })
        .returning();
      const created = found(inserted, "Procedure");
      await this.audit.record(tx, actor, {
        action: "encounter.procedure.record",
        resourceType: "clinic_procedure",
        resourceId: created.id,
        patientId: created.patientId,
        reason: created.lateEntryReason ?? undefined,
        metadata: { encounterId, code: created.code, quantity: created.quantity, lateEntry: created.lateEntryReason !== null },
      });
      await this.events.record(tx, {
        type: "ClinicProcedurePerformed",
        organizationId: actor.organizationId,
        aggregateType: "clinic_procedure",
        aggregateId: created.id,
        facilityId,
        patientId: created.patientId,
        payload: { procedureId: created.id, encounterId },
      });
      return created;
    });
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  /** Marks a procedure entered in error with a reason (the recorder, or someone who may amend consultations). */
  async markEnteredInError(actor: Actor, procedureId: string, reason: string): Promise<ClinicProcedureView> {
    const row = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(clinicProcedure)
        .where(and(eq(clinicProcedure.organizationId, actor.organizationId), eq(clinicProcedure.id, procedureId)))
        .for("update");
      const current = found(locked, "Procedure");
      if (current.enteredInErrorAt) throw new BusinessRuleError("The procedure is already marked entered in error", "already_entered_in_error");
      if (current.recordedBy !== actor.userId && !actor.permissions.has("encounter.amend")) {
        throw new ForbiddenError("Only the person who recorded it, or someone who may amend consultations, can mark it entered in error");
      }
      const [updated] = await tx
        .update(clinicProcedure)
        .set({ enteredInErrorAt: new Date(), enteredInErrorBy: actor.userId, enteredInErrorReason: reason })
        .where(eq(clinicProcedure.id, procedureId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "encounter.procedure.entered-in-error",
        resourceType: "clinic_procedure",
        resourceId: procedureId,
        patientId: current.patientId,
        reason,
        changes: { status: { from: "recorded", to: "entered_in_error" } },
      });
      await this.events.record(tx, {
        type: "ClinicProcedureEnteredInError",
        organizationId: actor.organizationId,
        aggregateType: "clinic_procedure",
        aggregateId: procedureId,
        facilityId: current.facilityId,
        patientId: current.patientId,
        payload: { procedureId, encounterId: current.encounterId },
      });
      return found(updated, "Procedure");
    });
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  // ---- reading ----------------------------------------------------------------------------------------------------

  /** Procedures recorded in one consultation (entries in error included, marked). */
  async listForEncounter(actor: Actor, encounterId: string): Promise<ClinicProcedureView[]> {
    const rows = await this.db
      .select()
      .from(clinicProcedure)
      .where(and(eq(clinicProcedure.organizationId, actor.organizationId), eq(clinicProcedure.encounterId, encounterId)))
      .orderBy(desc(clinicProcedure.performedAt), desc(clinicProcedure.recordedAt));
    const [first] = rows;
    if (first) {
      await this.audit.recordStandalone(actor, {
        action: "encounter.procedure.view",
        resourceType: "clinic_procedure",
        patientId: first.patientId,
        metadata: { encounterId, count: rows.length },
      });
    }
    return this.views(actor.organizationId, rows);
  }

  /** The patient's procedures (and records merged into it), latest first; entries in error included, marked. */
  async listForPatient(actor: Actor, patientId: string): Promise<ClinicProcedureView[]> {
    if (!(await this.patients.summaries(actor.organizationId, [patientId])).has(patientId)) throw new NotFoundError("Patient");
    const rows = await this.patientRecord(actor.organizationId, patientId, "desc");
    await this.audit.recordStandalone(actor, {
      action: "encounter.procedure.view",
      resourceType: "clinic_procedure",
      patientId,
      metadata: { count: rows.length },
    });
    return this.views(actor.organizationId, rows);
  }

  /** Every procedure of the patient (entries in error included) for a record export. Not audited here: the caller audits. */
  patientRecord(organizationId: string, patientId: string, order: "asc" | "desc" = "asc"): Promise<ClinicProcedureRecord[]> {
    const dir = order === "asc" ? asc : desc;
    return this.db
      .select()
      .from(clinicProcedure)
      .where(and(eq(clinicProcedure.organizationId, organizationId), filedAsPatient(clinicProcedure.patientId, patientId)))
      .orderBy(dir(clinicProcedure.performedAt), dir(clinicProcedure.recordedAt))
      .limit(1000);
  }

  /** The latest procedures for Patient 360 (not in error): short display fields only. Not audited here. */
  async workspace(organizationId: string, patientId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(clinicProcedure)
      .where(
        and(eq(clinicProcedure.organizationId, organizationId), filedAsPatient(clinicProcedure.patientId, patientId), isNull(clinicProcedure.enteredInErrorAt)),
      )
      .orderBy(desc(clinicProcedure.performedAt))
      .limit(limit);
    const names = await this.practitionerNames(organizationId, rows);
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      encounterId: r.encounterId,
      description: procedureText(r),
      performedAt: r.performedAt.toISOString(),
      performerName: names.get(r.performerPractitionerId) ?? null,
    }));
  }

  /** Timeline rows: code, name, quantity and site only — never notes. */
  timeline(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = clinicProcedure.performedAt;
    return this.db
      .select({
        id: clinicProcedure.id,
        patientId: clinicProcedure.patientId,
        facilityId: clinicProcedure.facilityId,
        at: timelineInstant(at),
        encounterId: clinicProcedure.encounterId,
        code: clinicProcedure.code,
        name: clinicProcedure.name,
        quantity: clinicProcedure.quantity,
        bodySite: clinicProcedure.bodySite,
        enteredInErrorAt: clinicProcedure.enteredInErrorAt,
      })
      .from(clinicProcedure)
      .where(
        and(
          eq(clinicProcedure.organizationId, organizationId),
          filedAsPatient(clinicProcedure.patientId, patientId),
          timelineRange("procedure", at, clinicProcedure.id, window),
          timelineFacility(clinicProcedure.facilityId, window),
        ),
      )
      .orderBy(desc(at), desc(clinicProcedure.id))
      .limit(window.limit);
  }

  /** A procedure as billing charges it; undefined once in error. Not audited here. */
  async billable(organizationId: string, procedureId: string) {
    const [row] = await this.db
      .select()
      .from(clinicProcedure)
      .where(and(eq(clinicProcedure.organizationId, organizationId), eq(clinicProcedure.id, procedureId)));
    if (!row || row.enteredInErrorAt) return undefined;
    const facility = await this.organizations.getFacility(organizationId, row.facilityId);
    return {
      id: row.id,
      patientId: row.patientId,
      facilityId: row.facilityId,
      procedureCode: row.code,
      description: procedureText(row),
      serviceDate: localDate(row.performedAt, facility.timezone),
      quantity: row.quantity,
    };
  }

  /** Performer names for many records (FHIR, the copy of the record). */
  practitionerNames(organizationId: string, rows: Array<{ performerPractitionerId: string }>): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.performerPractitionerId))];
    if (!ids.length) return Promise.resolve(new Map());
    return this.db
      .select({ id: practitioner.id, name: practitioner.displayName })
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), inArray(practitioner.id, ids)))
      .then((rows) => new Map(rows.map((r) => [r.id, r.name])));
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new BusinessRuleError("This code is already used, or an active procedure has this name", "procedure_exists");
      }
      throw error;
    }
  }

  private async views(organizationId: string, rows: ClinicProcedureRecord[]): Promise<ClinicProcedureView[]> {
    const userIds = [...new Set(rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy]).filter((id): id is string => Boolean(id)))];
    const [names, performers, facilities] = await Promise.all([
      userIds.length ? this.staff.staffNames(organizationId, userIds) : Promise.resolve(new Map<string, string>()),
      this.practitionerNames(organizationId, rows),
      rows.length ? this.organizations.listFacilities(organizationId) : Promise.resolve([]),
    ]);
    const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      facility: { id: r.facilityId, name: facilityName.get(r.facilityId) ?? "" },
      encounterId: r.encounterId,
      definitionId: r.definitionId,
      code: r.code,
      name: r.name,
      codeSystem: r.codeSystem,
      externalCode: r.externalCode,
      description: procedureText(r),
      performedAt: r.performedAt.toISOString(),
      performer: { id: r.performerPractitionerId, name: performers.get(r.performerPractitionerId) ?? "" },
      bodySite: r.bodySite,
      quantity: r.quantity,
      notes: r.notes,
      lateEntryReason: r.lateEntryReason,
      enteredInError:
        r.enteredInErrorAt && r.enteredInErrorReason
          ? {
              at: r.enteredInErrorAt.toISOString(),
              reason: r.enteredInErrorReason,
              byName: r.enteredInErrorBy ? (names.get(r.enteredInErrorBy) ?? null) : null,
            }
          : null,
      recordedAt: r.recordedAt.toISOString(),
      recordedBy: r.recordedBy,
      recordedByName: names.get(r.recordedBy) ?? null,
    }));
  }
}

function definitionView(row: ProcedureDefinitionRecord): ProcedureDefinitionView {
  const { organizationId: _organizationId, ...rest } = row;
  return rest;
}
