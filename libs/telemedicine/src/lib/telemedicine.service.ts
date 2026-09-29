import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { type AuditActor, AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainError,
  DomainEventPublisher,
  localDate,
  NotFoundError,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { eq, inArray, sql } from "drizzle-orm";
import { type Questionnaire, questionnaireSchema, RED_FLAGS } from "./questionnaire";
import { telemedicineSession, type TelemedicineSessionRecord } from "./telemedicine.schema";
import { canMove, roomName, videoOpen } from "./telemedicine.rules";
import { type OnlineAppointment, TELEMEDICINE_CLINIC, type TelemedicineClinic } from "./ports";
import { VIDEO_PROVIDER, type VideoJoin, type VideoProvider } from "./video";

/** The patient acting through the portal, as the API hands it over (audited with actor type "patient"). */
export interface PatientContext {
  organizationId: string;
  patientId: string;
  audit: AuditActor;
}

type OrgAppointment = OnlineAppointment & { organizationId: string };

type SessionSummary = Pick<
  TelemedicineSessionRecord,
  | "status"
  | "questionnaireSubmittedAt"
  | "redFlags"
  | "consentAcknowledgedAt"
  | "patientJoinedAt"
  | "clinicianJoinedAt"
  | "startedAt"
  | "endedAt"
  | "encounterId"
  | "patientInstructions"
>;

const EMPTY_SESSION: SessionSummary = {
  status: "scheduled",
  questionnaireSubmittedAt: null,
  redFlags: [],
  consentAcknowledgedAt: null,
  patientJoinedAt: null,
  clinicianJoinedAt: null,
  startedAt: null,
  endedAt: null,
  encounterId: null,
  patientInstructions: null,
};

/**
 * Online consultations (CLAUDE.md §10): pre-consult questionnaire, waiting
 * room, video, and the clinical encounter — which is the clinic's ordinary
 * encounter with modality "telemedicine", so notes, diagnoses, prescriptions,
 * lab orders and follow-up work exactly as in person. Clinicians can escalate
 * to in-person care at any time; not every condition suits telemedicine.
 */
@Injectable()
export class TelemedicineService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TELEMEDICINE_CLINIC) private readonly clinic: TelemedicineClinic,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProvider,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  get videoConfigured(): boolean {
    return this.video.configured;
  }

  // ---- Staff ------------------------------------------------------------------------------

  /** The facility's online consultations for a day (default today), with where each patient is. */
  async day(actor: Actor, date?: string) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const day = date ?? localDate(new Date(), facility.timezone);
    const appointments = await this.clinic.day(actor.organizationId, facilityId, day);
    const sessions = appointments.length
      ? await this.db
          .select()
          .from(telemedicineSession)
          .where(
            inArray(
              telemedicineSession.appointmentId,
              appointments.map((a) => a.id),
            ),
          )
      : [];
    await this.audit.recordStandalone(actor, {
      action: "telemedicine.day-view",
      resourceType: "telemedicine_session",
      metadata: { date: day, count: appointments.length },
    });
    return {
      date: day,
      timeZone: facility.timezone,
      videoConfigured: this.video.configured,
      consultations: appointments.map((a) => ({
        appointment: appointmentView(a),
        patient: a.patient,
        visitStatus: a.visitStatus,
        encounterId: a.encounterId,
        session: summary(sessions.find((s) => s.appointmentId === a.id)),
      })),
    };
  }

  /** One consultation with the pre-consult questionnaire (viewing is audited). */
  async get(actor: Actor, appointmentId: string) {
    const appointment = await this.requireOnline(actor.organizationId, appointmentId);
    this.assertFacility(actor, appointment);
    const session = await this.ensureSession(this.db, appointment);
    await this.audit.recordStandalone(actor, {
      action: "telemedicine.session-view",
      resourceType: "telemedicine_session",
      resourceId: session.id,
      patientId: appointment.patientId,
    });
    return this.staffView(appointment, session);
  }

  /**
   * Starts the consultation for a patient in the waiting room: opens the
   * telemedicine encounter (as the clinician) and returns a video token.
   */
  async start(actor: Actor, appointmentId: string) {
    const appointment = await this.requireOnline(actor.organizationId, appointmentId);
    this.assertFacility(actor, appointment);
    const current = await this.ensureSession(this.db, appointment);
    if (current.status === "in_consultation") return this.join(actor, appointmentId);
    if (current.status !== "waiting") {
      throw new BusinessRuleError(
        current.status === "scheduled" ? "The patient is not in the waiting room yet" : `The consultation has ${current.status}`,
        current.status === "scheduled" ? "patient_not_waiting" : "session_closed",
      );
    }
    const encounterId = await this.openEncounter(actor, current.visitId!);
    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const session = await this.lock(tx, current.id);
      if (!canMove(session.status, "in_consultation")) throw new ConflictError("The consultation was started by someone else", undefined, "session_changed");
      const [row] = await tx
        .update(telemedicineSession)
        .set({
          status: "in_consultation",
          encounterId,
          startedAt: now,
          startedBy: actor.userId,
          clinicianJoinedAt: now,
          updatedAt: now,
          version: sql`${telemedicineSession.version} + 1`,
        })
        .where(eq(telemedicineSession.id, session.id))
        .returning();
      await this.audit.record(tx, actor, {
        action: "telemedicine.start",
        resourceType: "telemedicine_session",
        resourceId: session.id,
        patientId: session.patientId,
        metadata: { encounterId, appointmentId },
      });
      await this.events.record(tx, sessionEvent("TelemedicineConsultationStarted", row!));
      return row!;
    });
    return { ...this.staffView(appointment, updated), video: await this.clinicianVideo(actor, updated) };
  }

  /** (Re)joins the video of a running consultation. */
  async join(actor: Actor, appointmentId: string) {
    const appointment = await this.requireOnline(actor.organizationId, appointmentId);
    this.assertFacility(actor, appointment);
    const session = await this.ensureSession(this.db, appointment);
    if (!videoOpen(session.status)) throw new BusinessRuleError("Video is available only during the consultation", "video_closed");
    await this.audit.recordStandalone(actor, {
      action: "telemedicine.join",
      resourceType: "telemedicine_session",
      resourceId: session.id,
      patientId: session.patientId,
    });
    return { ...this.staffView(appointment, session), video: await this.clinicianVideo(actor, session) };
  }

  /** Ends the call. The encounter stays open for documentation and is signed in the workspace. */
  async end(actor: Actor, appointmentId: string, patientInstructions?: string) {
    return this.close(actor, appointmentId, "ended", { patientInstructions });
  }

  /** Not suitable for an online consultation: the clinician directs the patient to in-person care. */
  async escalate(actor: Actor, appointmentId: string, reason: string, patientInstructions?: string) {
    return this.close(actor, appointmentId, "escalated", { reason, patientInstructions });
  }

  /** What the patient should do next, shown in MyHealth. */
  async setInstructions(actor: Actor, appointmentId: string, patientInstructions: string) {
    const appointment = await this.requireOnline(actor.organizationId, appointmentId);
    this.assertFacility(actor, appointment);
    return this.db.transaction(async (tx) => {
      const session = await this.lock(tx, (await this.ensureSession(tx, appointment)).id);
      if (session.status === "scheduled" || session.status === "waiting") {
        throw new BusinessRuleError("Instructions are written during or after the consultation", "session_not_started");
      }
      const [row] = await tx
        .update(telemedicineSession)
        .set({ patientInstructions, instructionsUpdatedAt: new Date(), updatedAt: new Date(), version: sql`${telemedicineSession.version} + 1` })
        .where(eq(telemedicineSession.id, session.id))
        .returning();
      await this.audit.record(tx, actor, {
        action: "telemedicine.instructions",
        resourceType: "telemedicine_session",
        resourceId: session.id,
        patientId: session.patientId,
      });
      return this.staffView(appointment, row!);
    });
  }

  // ---- Patient ----------------------------------------------------------------------------

  /** The patient's online consultations (from yesterday on). */
  async patientConsultations(patient: PatientContext) {
    const appointments = await this.clinic.patientOnline(patient.organizationId, patient.patientId);
    const sessions = appointments.length
      ? await this.db
          .select()
          .from(telemedicineSession)
          .where(
            inArray(
              telemedicineSession.appointmentId,
              appointments.map((a) => a.id),
            ),
          )
      : [];
    await this.audit.recordStandalone(patient.audit, {
      action: "portal.teleconsults-view",
      resourceType: "telemedicine_session",
      patientId: patient.patientId,
    });
    return appointments.map((a) =>
      this.patientView(
        a,
        sessions.find((s) => s.appointmentId === a.id),
      ),
    );
  }

  async patientConsultation(patient: PatientContext, appointmentId: string) {
    const appointment = await this.requireOwn(patient, appointmentId);
    const session = await this.ensureSession(this.db, appointment);
    return this.patientView(appointment, session);
  }

  /**
   * The pre-consult questionnaire, with the patient's acknowledgement of an
   * online consultation. Red flags are returned so the portal can urge
   * emergency care at once; the clinician sees them too.
   */
  async submitQuestionnaire(patient: PatientContext, appointmentId: string, input: unknown) {
    const parsed = questionnaireSchema.safeParse(input);
    if (!parsed.success) {
      throw new BusinessRuleError(
        parsed.error.issues[0]?.message ?? "Check your answers",
        "invalid_questionnaire",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    const answers: Questionnaire = parsed.data;
    const appointment = await this.requireOwn(patient, appointmentId);
    return this.db.transaction(async (tx) => {
      const session = await this.lock(tx, (await this.ensureSession(tx, appointment)).id);
      if (session.status !== "scheduled" && session.status !== "waiting") {
        throw new BusinessRuleError("The consultation has already started", "session_started");
      }
      const now = new Date();
      const [row] = await tx
        .update(telemedicineSession)
        .set({
          questionnaire: answers,
          questionnaireSubmittedAt: now,
          redFlags: answers.redFlags,
          consentAcknowledgedAt: session.consentAcknowledgedAt ?? now,
          updatedAt: now,
          version: sql`${telemedicineSession.version} + 1`,
        })
        .where(eq(telemedicineSession.id, session.id))
        .returning();
      await this.audit.record(tx, patient.audit, {
        action: "portal.teleconsult-questionnaire",
        resourceType: "telemedicine_session",
        resourceId: session.id,
        patientId: patient.patientId,
        metadata: { redFlags: answers.redFlags.length, acknowledgedOnlineConsultation: true },
      });
      await this.events.record(tx, sessionEvent("TelemedicineQuestionnaireSubmitted", row!, { redFlags: answers.redFlags.length }));
      return this.patientView(appointment, row!);
    });
  }

  /** The patient enters the waiting room (the questionnaire comes first). */
  async enterWaitingRoom(patient: PatientContext, appointmentId: string) {
    const appointment = await this.requireOwn(patient, appointmentId);
    const session = await this.ensureSession(this.db, appointment);
    if (session.status === "waiting" || session.status === "in_consultation") return this.patientView(appointment, session);
    if (session.status !== "scheduled") throw new BusinessRuleError(`The consultation has ${session.status}`, "session_closed");
    if (!session.questionnaireSubmittedAt) throw new BusinessRuleError("Please answer the questions before the consultation first", "questionnaire_required");
    const visit = await this.clinic.checkIn(patient.organizationId, appointmentId);
    return this.db.transaction(async (tx) => {
      const locked = await this.lock(tx, session.id);
      if (locked.status !== "scheduled") return this.patientView(appointment, locked);
      const [row] = await tx
        .update(telemedicineSession)
        .set({ status: "waiting", visitId: visit.id, patientJoinedAt: new Date(), updatedAt: new Date(), version: sql`${telemedicineSession.version} + 1` })
        .where(eq(telemedicineSession.id, locked.id))
        .returning();
      await this.audit.record(tx, patient.audit, {
        action: "portal.teleconsult-waiting-room",
        resourceType: "telemedicine_session",
        resourceId: locked.id,
        patientId: patient.patientId,
      });
      await this.events.record(tx, sessionEvent("TelemedicinePatientWaiting", row!));
      return this.patientView(appointment, row!);
    });
  }

  /** A video token for the patient, once the clinician has started the consultation. */
  async patientVideo(patient: PatientContext, appointmentId: string): Promise<VideoJoin> {
    const appointment = await this.requireOwn(patient, appointmentId);
    const session = await this.ensureSession(this.db, appointment);
    if (!videoOpen(session.status)) throw new BusinessRuleError("Your doctor has not started the consultation yet", "video_closed");
    if (!this.video.configured) throw new BusinessRuleError("Video is not available; your doctor will call you", "video_not_configured");
    const name = (await this.clinic.patientDisplayName(patient.organizationId, patient.patientId)) ?? "Patient";
    await this.audit.recordStandalone(patient.audit, {
      action: "portal.teleconsult-join",
      resourceType: "telemedicine_session",
      resourceId: session.id,
      patientId: patient.patientId,
    });
    return this.video.join(session.roomName, { identity: `patient:${patient.patientId}`, name });
  }

  // ---- internals --------------------------------------------------------------------------

  private async close(actor: Actor, appointmentId: string, to: "ended" | "escalated", options: { reason?: string; patientInstructions?: string }) {
    const appointment = await this.requireOnline(actor.organizationId, appointmentId);
    this.assertFacility(actor, appointment);
    return this.db.transaction(async (tx) => {
      const session = await this.lock(tx, (await this.ensureSession(tx, appointment)).id);
      if (!canMove(session.status, to))
        throw new BusinessRuleError(`A ${session.status.replace("_", " ")} consultation cannot be ${to}`, "invalid_session_status");
      const now = new Date();
      const [row] = await tx
        .update(telemedicineSession)
        .set({
          status: to,
          endedAt: now,
          endedBy: actor.userId,
          escalationReason: to === "escalated" ? options.reason : null,
          ...(options.patientInstructions ? { patientInstructions: options.patientInstructions, instructionsUpdatedAt: now } : {}),
          updatedAt: now,
          version: sql`${telemedicineSession.version} + 1`,
        })
        .where(eq(telemedicineSession.id, session.id))
        .returning();
      await this.audit.record(tx, actor, {
        action: to === "escalated" ? "telemedicine.escalate" : "telemedicine.end",
        resourceType: "telemedicine_session",
        resourceId: session.id,
        patientId: session.patientId,
        reason: options.reason,
        metadata: { encounterId: session.encounterId },
      });
      await this.events.record(tx, sessionEvent(to === "escalated" ? "TelemedicineEscalatedToInPerson" : "TelemedicineConsultationEnded", row!));
      return this.staffView(appointment, row!);
    });
  }

  private async openEncounter(actor: Actor, visitId: string): Promise<string> {
    try {
      return (await this.clinic.startEncounter(actor, visitId)).id;
    } catch (error) {
      // A previous attempt opened the encounter but did not record it on the session: adopt it.
      if (error instanceof DomainError && error.code === "encounter_exists") {
        const existing = await this.clinic.encounterForVisit(actor.organizationId, visitId);
        if (existing) return existing.id;
      }
      throw error;
    }
  }

  private async clinicianVideo(actor: Actor, session: TelemedicineSessionRecord): Promise<VideoJoin | null> {
    if (!this.video.configured) return null;
    return this.video.join(session.roomName, { identity: `staff:${actor.userId}`, name: actor.displayName });
  }

  /** Sessions are created on first use, one per online appointment (the unique key makes this race-free). */
  private async ensureSession(executor: DbExecutor, appointment: OrgAppointment): Promise<TelemedicineSessionRecord> {
    await executor
      .insert(telemedicineSession)
      .values({
        organizationId: appointment.organizationId,
        facilityId: appointment.facilityId,
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        roomName: roomName(randomBytes(16).toString("hex")),
      })
      .onConflictDoNothing({ target: telemedicineSession.appointmentId });
    const [row] = await executor.select().from(telemedicineSession).where(eq(telemedicineSession.appointmentId, appointment.id));
    if (!row) throw new NotFoundError("Online consultation");
    return row;
  }

  private async lock(tx: DbExecutor, sessionId: string): Promise<TelemedicineSessionRecord> {
    const [row] = await tx.select().from(telemedicineSession).where(eq(telemedicineSession.id, sessionId)).for("update");
    if (!row) throw new NotFoundError("Online consultation");
    return row;
  }

  private async requireOnline(organizationId: string, appointmentId: string): Promise<OrgAppointment> {
    const appointment = await this.clinic.appointment(organizationId, appointmentId);
    if (!appointment || appointment.modality !== "telemedicine") throw new NotFoundError("Online consultation");
    return { ...appointment, organizationId };
  }

  private async requireOwn(patient: PatientContext, appointmentId: string) {
    const appointment = await this.requireOnline(patient.organizationId, appointmentId);
    if (appointment.patientId !== patient.patientId) throw new NotFoundError("Online consultation");
    return appointment;
  }

  private assertFacility(actor: Actor, appointment: OnlineAppointment): void {
    if (requireFacilityId(actor) !== appointment.facilityId) throw new NotFoundError("Online consultation");
  }

  private staffView(appointment: OnlineAppointment, session: TelemedicineSessionRecord) {
    return {
      appointment: appointmentView(appointment),
      session: {
        ...summary(session),
        questionnaire: session.questionnaire,
        redFlagLabels: session.redFlags.map((f) => RED_FLAGS[f as keyof typeof RED_FLAGS] ?? f),
        escalationReason: session.escalationReason,
      },
      videoConfigured: this.video.configured,
    };
  }

  private patientView(appointment: OnlineAppointment, session: TelemedicineSessionRecord | undefined) {
    const s = summary(session);
    return {
      appointmentId: appointment.id,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      timeZone: appointment.timeZone,
      appointmentStatus: appointment.status,
      practitionerName: appointment.practitionerName,
      visitType: appointment.visitTypeName,
      status: s.status,
      questionnaireSubmitted: s.questionnaireSubmittedAt !== null,
      waitingRoomOpensAt: new Date(appointment.startsAt.getTime() - 30 * 60_000),
      videoConfigured: this.video.configured,
      patientInstructions: s.patientInstructions,
      escalated: s.status === "escalated",
    };
  }
}

function summary(session: TelemedicineSessionRecord | undefined): SessionSummary {
  if (!session) return EMPTY_SESSION;
  return {
    status: session.status,
    questionnaireSubmittedAt: session.questionnaireSubmittedAt,
    redFlags: session.redFlags,
    consentAcknowledgedAt: session.consentAcknowledgedAt,
    patientJoinedAt: session.patientJoinedAt,
    clinicianJoinedAt: session.clinicianJoinedAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    encounterId: session.encounterId,
    patientInstructions: session.patientInstructions,
  };
}

function appointmentView(a: OnlineAppointment) {
  return {
    id: a.id,
    patientId: a.patientId,
    practitionerId: a.practitionerId,
    practitionerName: a.practitionerName,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status,
    reason: a.reason,
    visitType: a.visitTypeName,
  };
}

function sessionEvent(type: string, session: TelemedicineSessionRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: session.organizationId,
    aggregateType: "telemedicine_session",
    aggregateId: session.id,
    facilityId: session.facilityId,
    patientId: session.patientId,
    payload: { appointmentId: session.appointmentId, encounterId: session.encounterId, status: session.status, ...extra },
  };
}
