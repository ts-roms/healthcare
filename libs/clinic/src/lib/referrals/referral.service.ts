import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  filedAsPatient,
  ForbiddenError,
  systemActor,
  VersionConflictError,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { facilityLetterhead, pdfDate, pdfDateTime, renderPdf } from "@healthcare/pdf";
import { and, asc, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  answerReferralSchema,
  cancelReferralSchema,
  completeReferralSchema,
  createReferralSchema,
  linkReferralAppointmentSchema,
  referralQuerySchema,
} from "../clinic.dto";
import { allergyIntolerance, appointment, diagnosis, encounter, practitioner, referral, referralNumberSequence, type ReferralRecord } from "../clinic.schema";
import { found, publicView } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { PATIENT_DIRECTORY, type PatientBrief, type PatientDirectory } from "../ports";
import { type ReferralAction, referralAllows, referralNumber } from "./referral.rules";

const URGENCY_LABEL = { routine: "Routine", urgent: "Urgent", emergency: "Emergency" } as const;

export type ReferralView = Omit<ReferralRecord, "organizationId"> & {
  referringPractitioner: { id: string; displayName: string; specialty: string | null } | null;
  toPractitioner: { id: string; displayName: string; specialty: string | null } | null;
  patient: PatientBrief | null;
  diagnoses: Array<{ id: string; code: string | null; display: string }>;
  /** Who is looking: whether they may answer or complete it (the API checks again). */
  forYou: boolean;
  byYou: boolean;
};

/**
 * Referrals (docs/domains/clinic.md, "Referrals"): the consultation's responsible practitioner refers the patient to a
 * practitioner of the organization (internal — they accept or decline, an appointment may be linked, and they complete
 * it with a note) or to an outside provider named as the referrer writes it (external — completed when the reply is
 * recorded, optionally with the reply stored as a document). Numbered RF########; what the referrer wrote never
 * changes; cancelled with a reason while open. The letter is a generated `referral_letter` document whose id is the
 * referral's. No referral form, network or electronic exchange of any agency or insurer is assumed.
 */
@Injectable()
export class ReferralService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly config: ClinicConfigService,
    private readonly organizations: OrganizationService,
    private readonly documents: DocumentsService,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  async create(actor: Actor, encounterId: string, input: z.infer<typeof createReferralSchema>): Promise<ReferralView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(encounter)
        .where(and(eq(encounter.organizationId, actor.organizationId), eq(encounter.id, encounterId)))
        .for("update");
      const consultation = found(row, "Encounter");
      if (consultation.status === "entered_in_error") throw new BusinessRuleError("This consultation was entered in error", "encounter_entered_in_error");
      if (!clinician || clinician.id !== consultation.practitionerId) {
        throw new ForbiddenError("Only the consultation's responsible practitioner refers from it");
      }
      if (input.kind === "internal") {
        const [target] = await tx
          .select({ id: practitioner.id, status: practitioner.status })
          .from(practitioner)
          .where(and(eq(practitioner.organizationId, actor.organizationId), eq(practitioner.id, input.toPractitionerId!)));
        if (!target || target.status !== "active") throw new BusinessRuleError("Choose an active practitioner of your organization", "practitioner_inactive");
        if (target.id === clinician.id) throw new BusinessRuleError("You cannot refer a patient to yourself", "referral_to_self");
      }
      const diagnosisIds = [...new Set(input.diagnosisIds)];
      if (diagnosisIds.length) {
        const rows = await tx
          .select({ id: diagnosis.id, status: diagnosis.status })
          .from(diagnosis)
          .where(and(eq(diagnosis.encounterId, encounterId), inArray(diagnosis.id, diagnosisIds)));
        if (rows.length !== diagnosisIds.length || rows.some((d) => d.status === "entered_in_error")) {
          throw new BusinessRuleError("List diagnoses recorded in this consultation", "diagnosis_not_in_encounter");
        }
      }
      const [counter] = await tx
        .insert(referralNumberSequence)
        .values({ organizationId: actor.organizationId, nextValue: 1 })
        .onConflictDoUpdate({ target: referralNumberSequence.organizationId, set: { nextValue: sql`${referralNumberSequence.nextValue} + 1` } })
        .returning({ value: referralNumberSequence.nextValue });
      if (!counter) throw new Error("Could not allocate a referral number");
      const [inserted] = await tx
        .insert(referral)
        .values({
          organizationId: actor.organizationId,
          facilityId: consultation.facilityId,
          patientId: consultation.patientId,
          encounterId,
          referringPractitionerId: clinician.id,
          referralNumber: referralNumber(counter.value),
          kind: input.kind,
          specialty: input.specialty ?? null,
          toPractitionerId: input.kind === "internal" ? input.toPractitionerId! : null,
          externalProvider: input.kind === "external" ? input.externalProvider! : null,
          externalFacility: input.kind === "external" ? (input.externalFacility ?? null) : null,
          externalContact: input.kind === "external" ? (input.externalContact ?? null) : null,
          urgency: input.urgency,
          reason: input.reason,
          clinicalSummary: input.clinicalSummary || null,
          diagnosisIds,
          issuedBy: actor.userId,
        })
        .returning();
      const created = found(inserted, "Referral");
      await this.audit.record(tx, actor, {
        action: "encounter.referral.create",
        resourceType: "referral",
        resourceId: created.id,
        patientId: created.patientId,
        metadata: {
          encounterId,
          referralNumber: created.referralNumber,
          kind: created.kind,
          urgency: created.urgency,
          toPractitionerId: created.toPractitionerId,
        },
      });
      await this.events.record(tx, this.event("ReferralCreated", created));
      return created;
    });
    await this.ensureLetter(created);
    return (await this.views(actor, [created]))[0]!;
  }

  /** Referrals made from one consultation, newest first. */
  async listForEncounter(actor: Actor, encounterId: string): Promise<ReferralView[]> {
    const rows = await this.db
      .select()
      .from(referral)
      .where(and(eq(referral.organizationId, actor.organizationId), eq(referral.encounterId, encounterId)))
      .orderBy(desc(referral.issuedAt));
    return this.views(actor, rows);
  }

  /**
   * Referrals to the caller (as a practitioner), made by them, open ones or all recent ones — optionally for one patient
   * (including records filed under a merged duplicate). Open ones oldest first; the others newest first.
   */
  async list(actor: Actor, query: z.infer<typeof referralQuerySchema>): Promise<ReferralView[]> {
    const conditions: SQL[] = [eq(referral.organizationId, actor.organizationId)];
    if (query.patientId) conditions.push(filedAsPatient(referral.patientId, query.patientId));
    if (query.view === "to_me" || query.view === "from_me") {
      const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId);
      if (!clinician) return [];
      conditions.push(eq(query.view === "to_me" ? referral.toPractitionerId : referral.referringPractitionerId, clinician.id));
    }
    if (query.view === "open") conditions.push(or(eq(referral.status, "sent"), eq(referral.status, "accepted"))!);
    const rows = await this.db
      .select()
      .from(referral)
      .where(and(...conditions))
      .orderBy(query.view === "open" ? asc(referral.issuedAt) : desc(referral.issuedAt))
      .limit(200);
    return this.views(actor, rows);
  }

  async get(actor: Actor, referralId: string): Promise<ReferralView> {
    const row = await this.find(this.db, actor.organizationId, referralId);
    await this.audit.recordStandalone(actor, { action: "encounter.referral.view", resourceType: "referral", resourceId: row.id, patientId: row.patientId });
    return (await this.views(actor, [row]))[0]!;
  }

  /** The practitioner referred to accepts, or declines with a reason the referrer reads. */
  async answer(actor: Actor, referralId: string, input: z.infer<typeof answerReferralSchema>): Promise<ReferralView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const accepted = input.decision === "accept";
    return this.change(actor, referralId, input.version, "answer", accepted ? "ReferralAccepted" : "ReferralDeclined", (current) => {
      if (!clinician || clinician.id !== current.toPractitionerId) throw new ForbiddenError("Only the practitioner referred to answers this referral");
      return {
        set: {
          status: accepted ? "accepted" : "declined",
          respondedAt: new Date(),
          respondedBy: actor.userId,
          responseNote: input.note ?? null,
        },
        action: accepted ? "encounter.referral.accept" : "encounter.referral.decline",
        reason: accepted ? undefined : input.note,
      };
    });
  }

  /** Links the appointment booked for an internal referral (with the practitioner referred to, for this patient). */
  async linkAppointment(actor: Actor, referralId: string, input: z.infer<typeof linkReferralAppointmentSchema>): Promise<ReferralView> {
    return this.change(actor, referralId, input.version, "link_appointment", null, async (current, tx) => {
      const [booked] = await tx
        .select()
        .from(appointment)
        .where(and(eq(appointment.organizationId, actor.organizationId), eq(appointment.id, input.appointmentId)));
      if (!booked || booked.patientId !== current.patientId || booked.practitionerId !== current.toPractitionerId) {
        throw new BusinessRuleError("Link an appointment of this patient with the practitioner referred to", "appointment_not_for_referral");
      }
      if (booked.status === "cancelled" || booked.status === "no_show") {
        throw new BusinessRuleError("That appointment was cancelled or missed", "appointment_not_active");
      }
      return { set: { appointmentId: booked.id }, action: "encounter.referral.appointment", metadata: { appointmentId: booked.id } };
    });
  }

  /**
   * Completes a referral: an internal one by the practitioner referred to (after accepting), with their note; an
   * external one when the outside provider's reply is recorded (by the referrer or staff who document consultations),
   * optionally with the reply stored as a document of the patient.
   */
  async complete(actor: Actor, referralId: string, input: z.infer<typeof completeReferralSchema>): Promise<ReferralView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    if (input.replyDocumentId) {
      // An ordinary, available document (the documents service checks the organization).
      const doc = await this.documents.get(actor, input.replyDocumentId).catch(() => undefined);
      if (!doc || doc.status !== "available") throw new BusinessRuleError("Attach an available document of this patient", "document_not_attachable");
    }
    return this.change(actor, referralId, input.version, "complete", "ReferralCompleted", async (current) => {
      if (current.kind === "internal") {
        if (!clinician || clinician.id !== current.toPractitionerId) throw new ForbiddenError("Only the practitioner referred to completes this referral");
        if (input.replyDocumentId) throw new BusinessRuleError("An internal referral is documented in the consultation", "reply_document_external_only");
      }
      if (input.replyDocumentId) {
        const doc = await this.documents.get(actor, input.replyDocumentId);
        if (doc.patientId !== current.patientId) throw new BusinessRuleError("Attach an available document of this patient", "document_not_attachable");
      }
      return {
        set: {
          status: "completed",
          completedAt: new Date(),
          completedBy: actor.userId,
          outcomeNote: input.outcomeNote,
          replyDocumentId: input.replyDocumentId ?? null,
        },
        action: "encounter.referral.complete",
        metadata: { replyDocumentId: input.replyDocumentId ?? null },
      };
    });
  }

  /** Cancels an open referral (the referrer, or staff who may amend consultations); its letter is archived. */
  async cancel(actor: Actor, referralId: string, input: z.infer<typeof cancelReferralSchema>): Promise<ReferralView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const view = await this.change(actor, referralId, input.version, "cancel", "ReferralCancelled", (current) => {
      if (clinician?.id !== current.referringPractitionerId && !actor.permissions.has("encounter.amend")) {
        throw new ForbiddenError("Only the referring practitioner, or staff who may amend consultations, cancel a referral");
      }
      return {
        set: { status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.userId, cancelReason: input.reason },
        action: "encounter.referral.cancel",
        reason: input.reason,
      };
    });
    await this.documents.archive(actor, view.id, `Referral ${view.referralNumber} cancelled: ${input.reason}`).catch(() => undefined);
    return view;
  }

  /** The letter: the stored document, or — for a cancelled referral — a fresh copy marked CANCELLED (not stored). */
  async letter(actor: Actor, referralId: string): Promise<{ filename: string; pdf: Buffer }> {
    const row = await this.find(this.db, actor.organizationId, referralId);
    const filename = `referral-${row.referralNumber}.pdf`;
    await this.audit.recordStandalone(actor, {
      action: "encounter.referral.print",
      resourceType: "referral",
      resourceId: row.id,
      patientId: row.patientId,
      metadata: { cancelled: row.status === "cancelled" },
    });
    if (row.status === "cancelled") return { filename, pdf: await this.render(row) };
    await this.ensureLetter(row);
    const { body } = await this.documents.content(actor, row.id);
    return { filename, pdf: body };
  }

  // ---- internals ------------------------------------------------------------------------------

  private async change(
    actor: Actor,
    referralId: string,
    version: number,
    allowed: ReferralAction,
    event: string | null,
    apply: (
      current: ReferralRecord,
      tx: DbExecutor,
    ) =>
      | { set: Partial<ReferralRecord>; action: string; reason?: string; metadata?: Record<string, unknown> }
      | Promise<{ set: Partial<ReferralRecord>; action: string; reason?: string; metadata?: Record<string, unknown> }>,
  ): Promise<ReferralView> {
    const updated = await this.db.transaction(async (tx) => {
      const current = await this.find(tx, actor.organizationId, referralId, true);
      if (current.version !== version) throw new VersionConflictError("Referral", version);
      if (!referralAllows(current, allowed)) {
        throw new BusinessRuleError(`A ${current.status} ${current.kind} referral does not allow that`, "invalid_referral_status");
      }
      const change = await apply(current, tx);
      const [row] = await tx
        .update(referral)
        .set({ ...change.set, version: current.version + 1 })
        .where(eq(referral.id, referralId))
        .returning();
      const updated = found(row, "Referral");
      await this.audit.record(tx, actor, {
        action: change.action,
        resourceType: "referral",
        resourceId: referralId,
        patientId: updated.patientId,
        reason: change.reason,
        changes: current.status !== updated.status ? { status: { from: current.status, to: updated.status } } : undefined,
        metadata: { referralNumber: updated.referralNumber, ...change.metadata },
      });
      if (event) await this.events.record(tx, this.event(event, updated));
      return updated;
    });
    return (await this.views(actor, [updated]))[0]!;
  }

  private event(type: string, row: ReferralRecord) {
    return {
      type,
      organizationId: row.organizationId,
      aggregateType: "referral",
      aggregateId: row.id,
      facilityId: row.facilityId,
      patientId: row.patientId,
      // Ids, number, kind and status only: never the reason or summary.
      payload: {
        encounterId: row.encounterId,
        referralNumber: row.referralNumber,
        kind: row.kind,
        status: row.status,
        referringPractitionerId: row.referringPractitionerId,
        toPractitionerId: row.toPractitionerId,
      },
    };
  }

  private async find(executor: DbExecutor, organizationId: string, referralId: string, lock = false): Promise<ReferralRecord> {
    const query = executor
      .select()
      .from(referral)
      .where(and(eq(referral.organizationId, organizationId), eq(referral.id, referralId)));
    const [row] = lock ? await query.for("update") : await query;
    return found(row, "Referral");
  }

  /** Stores the letter once (idempotent: the document's id is the referral's). */
  private async ensureLetter(row: ReferralRecord): Promise<void> {
    await this.documents.storeGenerated(systemActor(row.organizationId, row.facilityId, "referral"), {
      id: row.id,
      facilityId: row.facilityId,
      patientId: row.patientId,
      category: "referral_letter",
      title: `Referral ${row.referralNumber}`,
      fileName: `referral-${row.referralNumber}.pdf`,
      contentType: "application/pdf",
      body: await this.render(row),
    });
  }

  private async render(row: ReferralRecord): Promise<Buffer> {
    const ids = [row.referringPractitionerId, ...(row.toPractitionerId ? [row.toPractitionerId] : [])];
    const [organization, facility, patients, clinicians, diagnoses, allergies, [consultation]] = await Promise.all([
      this.organizations.getOrganization(row.organizationId),
      this.organizations.getFacility(row.organizationId, row.facilityId),
      this.patients.summaries(row.organizationId, [row.patientId]),
      this.db
        .select()
        .from(practitioner)
        .where(and(eq(practitioner.organizationId, row.organizationId), inArray(practitioner.id, ids))),
      row.diagnosisIds.length
        ? this.db
            .select({ code: diagnosis.code, display: diagnosis.display })
            .from(diagnosis)
            .where(and(eq(diagnosis.organizationId, row.organizationId), inArray(diagnosis.id, row.diagnosisIds)))
        : Promise.resolve([]),
      this.db
        .select({ substance: allergyIntolerance.substance, reaction: allergyIntolerance.reaction, verification: allergyIntolerance.verification })
        .from(allergyIntolerance)
        .where(
          and(
            eq(allergyIntolerance.organizationId, row.organizationId),
            filedAsPatient(allergyIntolerance.patientId, row.patientId),
            eq(allergyIntolerance.status, "active"),
          ),
        ),
      this.db.select({ startedAt: encounter.startedAt, modality: encounter.modality }).from(encounter).where(eq(encounter.id, row.encounterId)),
    ]);
    const patient = patients.get(row.patientId);
    const referrer = clinicians.find((c) => c.id === row.referringPractitionerId);
    const recipient = clinicians.find((c) => c.id === row.toPractitionerId);
    const to =
      row.kind === "internal"
        ? [recipient?.displayName, recipient?.specialty ?? row.specialty, facility.name].filter(Boolean).join(", ")
        : [row.externalProvider, row.externalFacility].filter(Boolean).join(", ");
    return renderPdf(
      {
        title: "Referral",
        letterhead: facilityLetterhead(organization.name, facility),
        printedAt: `Issued ${pdfDateTime(row.issuedAt, facility.timezone)}`,
        watermark: row.status === "cancelled" ? "CANCELLED" : undefined,
        footerNote: `Referral ${row.referralNumber}. Confidential: personal health information for the provider it is addressed to.`,
      },
      (w) => {
        w.fields([
          ["Referral number", row.referralNumber],
          ["Date", pdfDate(row.issuedAt, facility.timezone)],
          ["To", to],
          ["Contact", row.externalContact],
          ["Specialty or service", row.specialty],
          ["Urgency", URGENCY_LABEL[row.urgency]],
          ["Patient", patient?.displayName ?? "Patient"],
          ["Patient number", patient?.patientNumber ?? null],
          ["Age / sex", patient ? `${patient.age} / ${patient.sex}` : null],
          [consultation?.modality === "telemedicine" ? "Seen online on" : "Seen on", consultation ? pdfDate(consultation.startedAt, facility.timezone) : null],
        ]);
        w.heading("Reason for referral");
        w.paragraph(row.reason);
        if (row.clinicalSummary) {
          w.heading("Clinical summary");
          w.paragraph(row.clinicalSummary);
        }
        if (diagnoses.length) {
          w.heading("Diagnoses");
          w.table(
            [
              { header: "Diagnosis", width: 5 },
              { header: "Code", width: 1.5 },
            ],
            diagnoses.map((d) => [d.display, d.code ?? ""]),
          );
        }
        w.heading("Allergies");
        w.paragraph(
          allergies.length
            ? allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ""}${a.verification === "unconfirmed" ? ", unconfirmed" : ""}`).join("; ")
            : "None recorded as active. Confirm with the patient.",
        );
        w.space();
        w.paragraph("Please send your findings and recommendations back to the referring practitioner.", { muted: true });
        w.signatures([
          {
            name: referrer?.displayName ?? " ",
            role: referrer?.licenseNumber ? `Referring practitioner · License no. ${referrer.licenseNumber}` : "Referring practitioner",
          },
        ]);
      },
    );
  }

  private async views(actor: Actor, rows: ReferralRecord[]): Promise<ReferralView[]> {
    if (!rows.length) return [];
    const practitionerIds = [...new Set(rows.flatMap((r) => [r.referringPractitionerId, ...(r.toPractitionerId ? [r.toPractitionerId] : [])]))];
    const diagnosisIds = [...new Set(rows.flatMap((r) => r.diagnosisIds))];
    const [clinicians, patients, diagnoses, me] = await Promise.all([
      this.db
        .select({ id: practitioner.id, displayName: practitioner.displayName, specialty: practitioner.specialty })
        .from(practitioner)
        .where(and(eq(practitioner.organizationId, actor.organizationId), inArray(practitioner.id, practitionerIds))),
      this.patients.summaries(actor.organizationId, [...new Set(rows.map((r) => r.patientId))]),
      diagnosisIds.length
        ? this.db
            .select({ id: diagnosis.id, code: diagnosis.code, display: diagnosis.display })
            .from(diagnosis)
            .where(and(eq(diagnosis.organizationId, actor.organizationId), inArray(diagnosis.id, diagnosisIds)))
        : Promise.resolve([]),
      this.config.practitionerForUser(actor.organizationId, actor.userId),
    ]);
    const byId = new Map(clinicians.map((c) => [c.id, c]));
    return rows.map((r) => ({
      ...publicView(r),
      referringPractitioner: byId.get(r.referringPractitionerId) ?? null,
      toPractitioner: r.toPractitionerId ? (byId.get(r.toPractitionerId) ?? null) : null,
      patient: patients.get(r.patientId) ?? null,
      diagnoses: diagnoses.filter((d) => r.diagnosisIds.includes(d.id)),
      forYou: Boolean(me && me.id === r.toPractitionerId),
      byYou: Boolean(me && me.id === r.referringPractitionerId),
    }));
  }
}
