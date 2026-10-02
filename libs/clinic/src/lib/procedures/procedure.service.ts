import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  filedAsPatient,
  ForbiddenError,
  isFiledAs,
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
import { DocumentsService } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { facilityLetterhead, pdfDate, pdfDateTime, renderPdf } from "@healthcare/pdf";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { encounter, practitioner, visit, visitType } from "../clinic.schema";
import { found } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import type {
  createProcedureDefinitionSchema,
  procedureConsentSchema,
  publishConsentWordingSchema,
  recordProcedureSchema,
  recordVisitProcedureSchema,
  updateProcedureDefinitionSchema,
} from "./procedure.dto";
import { consentProblem, performedAtProblem, procedureText, recordingProblem, visitRecordingProblem } from "./procedure.rules";
import {
  type ClinicProcedureConsentRecord,
  type ClinicProcedureRecord,
  clinicProcedure,
  clinicProcedureConsent,
  clinicProcedureConsentWording,
  clinicProcedureDefinition,
  type ProcedureConsentWordingRecord,
  type ProcedureDefinitionRecord,
} from "./procedure.schema";
import { PROCEDURE_STAFF_NAMES, type ProcedureStaffNames } from "./ports";

/** A catalogue entry with its current consent wording (the latest version), if any. */
export type ProcedureDefinitionView = Omit<ProcedureDefinitionRecord, "organizationId"> & { consentWording: ConsentWordingView | null };

export interface ConsentWordingView {
  id: string;
  definitionId: string;
  version: number;
  title: string;
  body: string;
  createdAt: string;
}

/** The consent recorded against a procedure, as staff see it. */
export interface ProcedureConsentView {
  id: string;
  capturedVia: "paper" | "electronic" | "verbal";
  givenBy: "patient" | "representative";
  representativeName: string | null;
  representativeRelationship: string | null;
  wording: { id: string; version: number } | null;
  obtainedBy: { id: string; name: string };
  obtainedAt: string;
  documentId: string | null;
  notes: string | null;
  recordedAt: string;
  recordedByName: string | null;
}

/** One procedure as staff see it (staff notes included). */
export interface ClinicProcedureView {
  id: string;
  /** The record it is filed under (the patient, or a record merged into it). */
  patientId: string;
  facility: { id: string; name: string };
  /** The consultation it was recorded in, or null when performed under a queue visit without one. */
  encounterId: string | null;
  /** The queue visit it was filed under when there was no consultation. */
  visitId: string | null;
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
  /** The consent recorded against it, if any (the catalogue entry may require one). */
  consent: ProcedureConsentView | null;
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
  performed_before_visit: "The time given is before the patient checked in",
  visit_closed: "The visit is closed; record the procedure under a consultation or a new visit",
  visit_online: "Nothing is performed on the patient in an online visit",
  procedure_requires_consultation: "This procedure is recorded in a consultation (the catalogue does not allow it outside one)",
  procedure_consent_required: "Record the patient's consent with this procedure",
  consent_after_procedure: "The consent was obtained after the procedure was performed",
  consent_wording_required: "Say which published wording the patient was shown",
};

/** What a procedure is filed under, resolved before it is recorded. */
interface FiledUnder {
  patientId: string;
  encounterId: string | null;
  visitId: string | null;
  lateEntryReason: string | null;
}

/**
 * Procedures performed at the clinic (docs/domains/clinic.md, "Procedures"): the organization's own catalogue (with its
 * own consent wording and note template per entry), procedures recorded in an in-person consultation or — for entries
 * the organization allows — under a queue visit without one, with who performed them and the consent obtained.
 * Immutable: a mistake is marked entered in error (billing cancels its charge if not yet invoiced). Nothing decides
 * whether a procedure was indicated or who may consent for whom.
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
    private readonly documents: DocumentsService,
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
    const wording = await this.currentWording(
      actor.organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => definitionView(r, wording.get(r.id) ?? null));
  }

  /** Every version of the consent wording of a catalogue entry, latest first. */
  async consentWordings(actor: Actor, definitionId: string): Promise<ConsentWordingView[]> {
    await this.definition(actor.organizationId, definitionId);
    const rows = await this.db
      .select()
      .from(clinicProcedureConsentWording)
      .where(and(eq(clinicProcedureConsentWording.organizationId, actor.organizationId), eq(clinicProcedureConsentWording.definitionId, definitionId)))
      .orderBy(desc(clinicProcedureConsentWording.version));
    return rows.map(wordingView);
  }

  /** Publishes the next version of the organization's consent wording for a catalogue entry (append-only). */
  async publishConsentWording(actor: Actor, definitionId: string, input: z.output<typeof publishConsentWordingSchema>): Promise<ConsentWordingView> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: clinicProcedureDefinition.id })
        .from(clinicProcedureDefinition)
        .where(and(eq(clinicProcedureDefinition.organizationId, actor.organizationId), eq(clinicProcedureDefinition.id, definitionId)))
        .for("update");
      found(locked, "Procedure");
      const [latest] = await tx
        .select({ version: clinicProcedureConsentWording.version })
        .from(clinicProcedureConsentWording)
        .where(and(eq(clinicProcedureConsentWording.organizationId, actor.organizationId), eq(clinicProcedureConsentWording.definitionId, definitionId)))
        .orderBy(desc(clinicProcedureConsentWording.version))
        .limit(1);
      const version = (latest?.version ?? 0) + 1;
      const [row] = await tx
        .insert(clinicProcedureConsentWording)
        .values({ organizationId: actor.organizationId, definitionId, version, title: input.title, body: input.body, createdBy: actor.userId })
        .returning();
      const created = found(row, "Consent wording");
      await this.audit.record(tx, actor, {
        action: "clinic.procedure-consent-wording.publish",
        resourceType: "clinic_procedure_consent_wording",
        resourceId: created.id,
        metadata: { definitionId, version },
      });
      return wordingView(created);
    });
  }

  /**
   * A printable consent form for the patient to sign: the facility's letterhead, the patient's identification, the
   * procedure and the current wording with its version, and signature lines. Not stored: the signed form is scanned
   * and uploaded as a `consent_form` document and linked when the consent is recorded. Audited.
   */
  async consentFormPdf(actor: Actor, definitionId: string, patientId: string): Promise<{ filename: string; pdf: Buffer }> {
    const facilityId = requireFacilityId(actor);
    const definition = await this.definition(actor.organizationId, definitionId);
    const wording = (await this.currentWording(actor.organizationId, [definitionId])).get(definitionId);
    if (!wording) throw new BusinessRuleError("No consent wording is published for this procedure", "consent_wording_not_published");
    const [organization, facility, patients] = await Promise.all([
      this.organizations.getOrganization(actor.organizationId),
      this.organizations.getFacility(actor.organizationId, facilityId),
      this.patients.summaries(actor.organizationId, [patientId]),
    ]);
    const patient = patients.get(patientId);
    if (!patient) throw new NotFoundError("Patient");
    await this.audit.recordStandalone(actor, {
      action: "clinic.procedure-consent-form.print",
      resourceType: "clinic_procedure_consent_wording",
      resourceId: wording.id,
      patientId,
      metadata: { definitionId, version: wording.version },
    });
    const pdf = await renderPdf(
      {
        title: wording.title,
        subtitle: `Consent to ${definition.name}`,
        letterhead: facilityLetterhead(organization.name, facility),
        printedAt: `Printed ${pdfDateTime(new Date(), facility.timezone)}`,
        footerNote: `Consent wording version ${wording.version} of ${organization.name}. The signed form is kept with the patient's record.`,
      },
      (w) => {
        w.fields([
          ["Patient", patient.displayName],
          ["Patient number", patient.patientNumber],
          ["Procedure", `${definition.name} (${definition.code})`],
          ["Wording", `${wording.title}, version ${wording.version}`],
          ["Date", pdfDate(new Date(), facility.timezone)],
        ]);
        w.space();
        for (const paragraph of wording.body.split(/\n{2,}/)) w.paragraph(paragraph.replace(/\s*\n\s*/g, " "));
        w.space(1.2);
        w.signatures([
          { name: "Patient or representative", role: "Signature over printed name, relationship and date" },
          { name: "Clinician", role: "Signature over printed name and date" },
        ]);
      },
    );
    return { filename: `consent-${definition.code}-v${wording.version}.pdf`, pdf };
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
            consentRequired: input.consentRequired,
            allowedOutsideConsultation: input.allowedOutsideConsultation,
            noteTemplate: input.noteTemplate ?? null,
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
        return definitionView(created, null);
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
          consentRequired: input.consentRequired ?? before.consentRequired,
          allowedOutsideConsultation: input.allowedOutsideConsultation ?? before.allowedOutsideConsultation,
          noteTemplate: input.noteTemplate === undefined ? before.noteTemplate : input.noteTemplate,
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
        const wording = (await this.currentWording(actor.organizationId, [definitionId])).get(definitionId) ?? null;
        return definitionView(found(row, "Procedure"), wording);
      }),
    );
  }

  // ---- recording --------------------------------------------------------------------------------------------------

  /** Records a procedure performed in the consultation (at the selected facility). */
  async record(actor: Actor, encounterId: string, input: z.output<typeof recordProcedureSchema>): Promise<ClinicProcedureView> {
    return this.recordUnder(actor, input, async (tx, performedAt, now) => {
      const [consultation] = await tx
        .select()
        .from(encounter)
        .where(and(eq(encounter.organizationId, actor.organizationId), eq(encounter.id, encounterId)))
        .for("share");
      const current = found(consultation, "Encounter");
      if (current.facilityId !== requireFacilityId(actor)) throw new BusinessRuleError("The consultation is at another facility", "encounter_other_facility");
      const problem =
        recordingProblem(current, { canAmend: actor.permissions.has("encounter.amend") }, input.lateEntryReason) ??
        performedAtProblem(performedAt, current.startedAt, now);
      if (problem === "amendment_permission_required") throw new ForbiddenError(PROBLEM_MESSAGE[problem]!);
      if (problem) throw new BusinessRuleError(PROBLEM_MESSAGE[problem]!, problem);
      return {
        patientId: current.patientId,
        encounterId,
        visitId: null,
        lateEntryReason: current.status === "completed" ? (input.lateEntryReason ?? null) : null,
      };
    });
  }

  /**
   * Records a procedure performed under a queue visit without a consultation (procedure.record): the visit is open and
   * in person at the selected facility, and the catalogue entry allows it. No late entry: nothing is signed.
   */
  async recordForVisit(actor: Actor, visitId: string, input: z.output<typeof recordVisitProcedureSchema>): Promise<ClinicProcedureView> {
    return this.recordUnder(actor, input, async (tx, performedAt, now, definition) => {
      const [row] = await tx
        .select({ visit, modality: visitType.modality })
        .from(visit)
        .innerJoin(visitType, eq(visitType.id, visit.visitTypeId))
        .where(and(eq(visit.organizationId, actor.organizationId), eq(visit.id, visitId)))
        .for("share", { of: visit });
      const current = found(row?.visit, "Visit");
      if (current.facilityId !== requireFacilityId(actor)) throw new BusinessRuleError("The visit is at another facility", "visit_other_facility");
      const problem = visitRecordingProblem({ status: current.status, modality: row!.modality }, definition);
      if (problem) throw new BusinessRuleError(PROBLEM_MESSAGE[problem]!, problem);
      const when = performedAtProblem(performedAt, current.checkedInAt, now);
      if (when === "performed_before_encounter") throw new BusinessRuleError(PROBLEM_MESSAGE.performed_before_visit!, "performed_before_visit");
      if (when) throw new BusinessRuleError(PROBLEM_MESSAGE[when]!, when);
      return { patientId: current.patientId, encounterId: null, visitId, lateEntryReason: null };
    });
  }

  /**
   * Records a procedure once what it is filed under is resolved (a consultation or a visit): the catalogue entry, the
   * performer, the consent when given (required when the entry says so), the audit event and the domain event, in one
   * transaction.
   */
  private async recordUnder(
    actor: Actor,
    input: z.output<typeof recordVisitProcedureSchema> & { lateEntryReason?: string },
    resolve: (tx: DbExecutor, performedAt: Date, now: Date, definition: ProcedureDefinitionRecord) => Promise<FiledUnder>,
  ): Promise<ClinicProcedureView> {
    const facilityId = requireFacilityId(actor);
    const now = new Date();
    const performedAt = input.performedAt ? new Date(input.performedAt) : now;
    const own = input.performerPractitionerId ? null : await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const performerId = input.performerPractitionerId ?? own?.id;
    if (!performerId) throw new BusinessRuleError("Choose who performed the procedure", "performer_required");

    const row = await this.db.transaction(async (tx) => {
      const [definition] = await tx
        .select()
        .from(clinicProcedureDefinition)
        .where(and(eq(clinicProcedureDefinition.organizationId, actor.organizationId), eq(clinicProcedureDefinition.id, input.definitionId)));
      const procedure = found(definition, "Procedure");
      if (procedure.status !== "active") throw new BusinessRuleError(`${procedure.name} is no longer in the catalogue`, "procedure_inactive");
      if (procedure.requiresBodySite && !input.bodySite) throw new BusinessRuleError(`Say where ${procedure.name} was done`, "body_site_required");
      const filed = await resolve(tx, performedAt, now, procedure);
      const performer = await this.activePractitioner(tx, actor.organizationId, performerId);
      const consent = await this.prepareConsent(tx, actor, input.consent ?? null, {
        definition: procedure,
        patientId: filed.patientId,
        performedAt,
        performerId: performer.id,
      });

      const [inserted] = await tx
        .insert(clinicProcedure)
        .values({
          organizationId: actor.organizationId,
          patientId: filed.patientId,
          facilityId,
          encounterId: filed.encounterId,
          visitId: filed.visitId,
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
          lateEntryReason: filed.lateEntryReason,
          recordedBy: actor.userId,
        })
        .returning();
      const created = found(inserted, "Procedure");
      if (consent) await this.insertConsent(tx, actor, created, consent);
      await this.audit.record(tx, actor, {
        action: "encounter.procedure.record",
        resourceType: "clinic_procedure",
        resourceId: created.id,
        patientId: created.patientId,
        reason: created.lateEntryReason ?? undefined,
        metadata: {
          encounterId: created.encounterId,
          visitId: created.visitId,
          code: created.code,
          quantity: created.quantity,
          lateEntry: created.lateEntryReason !== null,
          consent: consent !== null,
        },
      });
      await this.events.record(tx, {
        type: "ClinicProcedurePerformed",
        organizationId: actor.organizationId,
        aggregateType: "clinic_procedure",
        aggregateId: created.id,
        facilityId,
        patientId: created.patientId,
        payload: { procedureId: created.id, encounterId: created.encounterId, visitId: created.visitId },
      });
      return created;
    });
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  /**
   * Records the consent obtained for a procedure that was recorded without one (once; someone who records procedures:
   * encounter.write or procedure.record). The consent must have been obtained not after the procedure.
   */
  async addConsent(actor: Actor, procedureId: string, input: z.output<typeof procedureConsentSchema>): Promise<ClinicProcedureView> {
    if (!actor.permissions.has("encounter.write") && !actor.permissions.has("procedure.record")) {
      throw new ForbiddenError("Recording consent needs permission to record procedures");
    }
    const row = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(clinicProcedure)
        .where(and(eq(clinicProcedure.organizationId, actor.organizationId), eq(clinicProcedure.id, procedureId)))
        .for("update");
      const current = found(locked, "Procedure");
      if (current.enteredInErrorAt) throw new BusinessRuleError("The procedure is marked entered in error", "procedure_entered_in_error");
      const [existing] = await tx
        .select({ id: clinicProcedureConsent.id })
        .from(clinicProcedureConsent)
        .where(eq(clinicProcedureConsent.procedureId, procedureId));
      if (existing) throw new BusinessRuleError("Consent is already recorded for this procedure", "consent_already_recorded");
      const [definition] = await tx
        .select()
        .from(clinicProcedureDefinition)
        .where(and(eq(clinicProcedureDefinition.organizationId, actor.organizationId), eq(clinicProcedureDefinition.id, current.definitionId)));
      const consent = await this.prepareConsent(tx, actor, input, {
        definition: found(definition, "Procedure"),
        patientId: current.patientId,
        performedAt: current.performedAt,
        performerId: current.performerPractitionerId,
      });
      await this.insertConsent(tx, actor, current, consent!);
      return current;
    });
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  /** Checks the consent given with a procedure and resolves what it refers to; null when none was given and none is required. */
  private async prepareConsent(
    tx: DbExecutor,
    actor: Actor,
    input: z.output<typeof procedureConsentSchema> | null,
    context: { definition: ProcedureDefinitionRecord; patientId: string; performedAt: Date; performerId: string },
  ): Promise<Omit<typeof clinicProcedureConsent.$inferInsert, "organizationId" | "patientId" | "procedureId" | "recordedBy"> | null> {
    const wording = input
      ? input.wordingId
        ? await this.wordingOf(tx, actor.organizationId, context.definition.id, input.wordingId)
        : ((await this.currentWording(actor.organizationId, [context.definition.id])).get(context.definition.id) ?? null)
      : null;
    const obtainedAt = input?.obtainedAt ? new Date(input.obtainedAt) : context.performedAt;
    const problem = consentProblem(
      context.definition,
      input ? { capturedVia: input.capturedVia, obtainedAt, wordingId: wording?.id ?? null } : null,
      context.performedAt,
    );
    if (problem) throw new BusinessRuleError(PROBLEM_MESSAGE[problem]!, problem);
    if (!input) return null;
    const obtainedBy = input.obtainedByPractitionerId
      ? (await this.activePractitioner(tx, actor.organizationId, input.obtainedByPractitionerId)).id
      : context.performerId;
    if (input.documentId) {
      const doc = (await this.documents.describe(actor.organizationId, [input.documentId])).get(input.documentId);
      if (!doc || doc.status !== "available" || doc.category !== "consent_form" || !(await isFiledAs(this.db, doc.patientId, context.patientId))) {
        throw new BusinessRuleError("Link a consent form uploaded for this patient", "document_not_consent_form");
      }
    }
    return {
      wordingId: wording?.id ?? null,
      wordingVersion: wording?.version ?? null,
      capturedVia: input.capturedVia,
      givenBy: input.givenBy,
      representativeName: input.givenBy === "representative" ? (input.representativeName ?? null) : null,
      representativeRelationship: input.givenBy === "representative" ? (input.representativeRelationship ?? null) : null,
      obtainedByPractitionerId: obtainedBy,
      obtainedAt,
      documentId: input.documentId ?? null,
      notes: input.notes ?? null,
    };
  }

  private async insertConsent(
    tx: DbExecutor,
    actor: Actor,
    procedure: ClinicProcedureRecord,
    consent: NonNullable<Awaited<ReturnType<ClinicProcedureService["prepareConsent"]>>>,
  ): Promise<void> {
    const [row] = await tx
      .insert(clinicProcedureConsent)
      .values({ ...consent, organizationId: actor.organizationId, patientId: procedure.patientId, procedureId: procedure.id, recordedBy: actor.userId })
      .returning({ id: clinicProcedureConsent.id });
    await this.audit.record(tx, actor, {
      action: "clinic.procedure-consent.record",
      resourceType: "clinic_procedure_consent",
      resourceId: row!.id,
      patientId: procedure.patientId,
      metadata: {
        procedureId: procedure.id,
        capturedVia: consent.capturedVia,
        givenBy: consent.givenBy,
        wordingVersion: consent.wordingVersion,
        documentLinked: consent.documentId !== null,
      },
    });
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
        payload: { procedureId, encounterId: current.encounterId, visitId: current.visitId },
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

  /** Procedures recorded under one queue visit without a consultation (entries in error included, marked). */
  async listForVisit(actor: Actor, visitId: string): Promise<ClinicProcedureView[]> {
    const rows = await this.db
      .select()
      .from(clinicProcedure)
      .where(and(eq(clinicProcedure.organizationId, actor.organizationId), eq(clinicProcedure.visitId, visitId)))
      .orderBy(desc(clinicProcedure.performedAt), desc(clinicProcedure.recordedAt));
    const [first] = rows;
    if (first) {
      await this.audit.recordStandalone(actor, {
        action: "encounter.procedure.view",
        resourceType: "clinic_procedure",
        patientId: first.patientId,
        metadata: { visitId, count: rows.length },
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
      visitId: r.visitId,
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
        visitId: clinicProcedure.visitId,
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

  private async definition(organizationId: string, definitionId: string): Promise<ProcedureDefinitionRecord> {
    const [row] = await this.db
      .select()
      .from(clinicProcedureDefinition)
      .where(and(eq(clinicProcedureDefinition.organizationId, organizationId), eq(clinicProcedureDefinition.id, definitionId)));
    return found(row, "Procedure");
  }

  private async activePractitioner(executor: DbExecutor, organizationId: string, practitionerId: string): Promise<{ id: string }> {
    const [performer] = await executor
      .select({ id: practitioner.id, status: practitioner.status })
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), eq(practitioner.id, practitionerId)));
    if (!performer || performer.status !== "active") throw new BusinessRuleError("Choose an active practitioner of your organization", "practitioner_inactive");
    return { id: performer.id };
  }

  /** The latest wording version per catalogue entry. */
  private async currentWording(organizationId: string, definitionIds: string[]): Promise<Map<string, ConsentWordingView>> {
    if (!definitionIds.length) return new Map();
    const rows = await this.db
      .select()
      .from(clinicProcedureConsentWording)
      .where(and(eq(clinicProcedureConsentWording.organizationId, organizationId), inArray(clinicProcedureConsentWording.definitionId, definitionIds)))
      .orderBy(asc(clinicProcedureConsentWording.definitionId), desc(clinicProcedureConsentWording.version));
    const current = new Map<string, ConsentWordingView>();
    for (const row of rows) if (!current.has(row.definitionId)) current.set(row.definitionId, wordingView(row));
    return current;
  }

  private async wordingOf(executor: DbExecutor, organizationId: string, definitionId: string, wordingId: string): Promise<ConsentWordingView> {
    const [row] = await executor
      .select()
      .from(clinicProcedureConsentWording)
      .where(
        and(
          eq(clinicProcedureConsentWording.organizationId, organizationId),
          eq(clinicProcedureConsentWording.definitionId, definitionId),
          eq(clinicProcedureConsentWording.id, wordingId),
        ),
      );
    if (!row) throw new BusinessRuleError("The wording is not one published for this procedure", "consent_wording_unknown");
    return wordingView(row);
  }

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
    const consents: ClinicProcedureConsentRecord[] = rows.length
      ? await this.db
          .select()
          .from(clinicProcedureConsent)
          .where(
            and(
              eq(clinicProcedureConsent.organizationId, organizationId),
              inArray(
                clinicProcedureConsent.procedureId,
                rows.map((r) => r.id),
              ),
            ),
          )
      : [];
    const consentOf = new Map(consents.map((c) => [c.procedureId, c]));
    const userIds = [
      ...new Set([...rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy]), ...consents.map((c) => c.recordedBy)].filter((id): id is string => Boolean(id))),
    ];
    const [names, performers, facilities] = await Promise.all([
      userIds.length ? this.staff.staffNames(organizationId, userIds) : Promise.resolve(new Map<string, string>()),
      this.practitionerNames(organizationId, [...rows, ...consents.map((c) => ({ performerPractitionerId: c.obtainedByPractitionerId }))]),
      rows.length ? this.organizations.listFacilities(organizationId) : Promise.resolve([]),
    ]);
    const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
    const consentView = (c: ClinicProcedureConsentRecord | undefined): ProcedureConsentView | null =>
      c
        ? {
            id: c.id,
            capturedVia: c.capturedVia,
            givenBy: c.givenBy,
            representativeName: c.representativeName,
            representativeRelationship: c.representativeRelationship,
            wording: c.wordingId && c.wordingVersion ? { id: c.wordingId, version: c.wordingVersion } : null,
            obtainedBy: { id: c.obtainedByPractitionerId, name: performers.get(c.obtainedByPractitionerId) ?? "" },
            obtainedAt: c.obtainedAt.toISOString(),
            documentId: c.documentId,
            notes: c.notes,
            recordedAt: c.recordedAt.toISOString(),
            recordedByName: names.get(c.recordedBy) ?? null,
          }
        : null;
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      facility: { id: r.facilityId, name: facilityName.get(r.facilityId) ?? "" },
      encounterId: r.encounterId,
      visitId: r.visitId,
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
      consent: consentView(consentOf.get(r.id)),
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

function definitionView(row: ProcedureDefinitionRecord, consentWording: ConsentWordingView | null): ProcedureDefinitionView {
  const { organizationId: _organizationId, ...rest } = row;
  return { ...rest, consentWording };
}

function wordingView(row: ProcedureConsentWordingRecord): ConsentWordingView {
  return { id: row.id, definitionId: row.definitionId, version: row.version, title: row.title, body: row.body, createdAt: row.createdAt.toISOString() };
}
