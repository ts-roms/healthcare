import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  NotFoundError,
  PgErrorCode,
  requireFacilityId,
  systemActor,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { assignVisitSchema, callVisitSchema, checkInSchema, moveVisitSchema, walkInSchema } from "../clinic.dto";
import { appointment, encounter, facilityQueueCounter, type Modality, visit, type VisitRecord, visitType, type VisitStatus } from "../clinic.schema";
import { assertVersion, found, publicView } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { appointmentEvent } from "../appointments/appointment.service";
import { canApply } from "../domain/appointment-state";
import { ACTIVE_VISIT_STATUSES, canTransition, compareQueueOrder, queueTicket, requiresReason } from "../domain/queue-state";
import { PATIENT_DIRECTORY, type PatientBrief, type PatientDirectory } from "../ports";

export type VisitView = Omit<VisitRecord, "organizationId"> & { ticket: string };

export interface QueueEntryView extends VisitView {
  patient: PatientBrief | null;
  waitingMinutes: number;
  /** The visit's consultation, once started (encounters entered in error are ignored). */
  encounterId: string | null;
  /** From the visit type: an online visit is started from Telemedicine, not with an ordinary consultation. */
  modality: Modality;
}

export function toVisitView(row: VisitRecord): VisitView {
  return { ...publicView(row), ticket: queueTicket(row.queueNumber) };
}

/** Event consumed by realtime queue boards; carries ids and status only. */
export function queueEvent(row: VisitRecord) {
  return {
    type: "QueueEntryUpdated",
    organizationId: row.organizationId,
    aggregateType: "visit",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: { status: row.status, queueNumber: row.queueNumber, queueDate: row.queueDate, priority: row.priority, calledTo: row.calledTo },
  };
}

/** Arrivals and the facility queue. A visit is one arrival; it is the queue entry. */
@Injectable()
export class VisitService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly organizations: OrganizationService,
    private readonly config: ClinicConfigService,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  async walkIn(actor: Actor, input: z.infer<typeof walkInSchema>): Promise<VisitView> {
    const facilityId = requireFacilityId(actor);
    await this.config.requireActiveVisitType(actor.organizationId, input.visitTypeId);
    if (input.assignedPractitionerId) await this.config.requireActivePractitioner(actor.organizationId, input.assignedPractitionerId);
    return this.guardArrival(input.patientId, () =>
      this.db.transaction(async (tx) => {
        const row = await this.insertVisit(tx, actor, facilityId, {
          patientId: input.patientId,
          visitTypeId: input.visitTypeId,
          arrivalMode: "walk_in",
          priority: input.priority,
          chiefComplaint: input.chiefComplaint ?? null,
          assignedPractitionerId: input.assignedPractitionerId ?? null,
        });
        await this.audit.record(tx, actor, {
          action: "visit.walk-in",
          resourceType: "visit",
          resourceId: row.id,
          patientId: row.patientId,
          metadata: { queueNumber: row.queueNumber },
        });
        await this.events.record(tx, queueEvent(row));
        return toVisitView(row);
      }),
    );
  }

  /** Arrival for a booked appointment: marks it checked in and queues the patient, atomically. */
  async checkInAppointment(actor: Actor, appointmentId: string, input: z.infer<typeof checkInSchema>): Promise<VisitView> {
    const facilityId = requireFacilityId(actor);
    return this.guardArrival(undefined, () =>
      this.db.transaction(async (tx) => {
        const [booked] = await tx
          .select()
          .from(appointment)
          .where(and(eq(appointment.organizationId, actor.organizationId), eq(appointment.id, appointmentId)))
          .for("update");
        const current = found(booked, "Appointment");
        if (current.facilityId !== facilityId) throw new BusinessRuleError("The appointment is at another facility", "wrong_facility");
        if (!canApply("check_in", current.status))
          throw new BusinessRuleError(`Cannot check in an appointment that is ${current.status}`, "invalid_appointment_status");
        const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
        if (localDate(current.startsAt, facility.timezone) !== localDate(new Date(), facility.timezone)) {
          throw new BusinessRuleError("Only today’s appointments can be checked in", "not_today");
        }
        const [updated] = await tx
          .update(appointment)
          .set({
            status: "checked_in",
            checkedInAt: new Date(),
            updatedBy: actor.userId,
            updatedByPatient: false,
            updatedAt: new Date(),
            version: sql`${appointment.version} + 1`,
          })
          .where(eq(appointment.id, appointmentId))
          .returning();
        const row = await this.insertVisit(tx, actor, facilityId, {
          patientId: current.patientId,
          appointmentId,
          visitTypeId: current.visitTypeId,
          arrivalMode: "appointment",
          priority: input.priority,
          chiefComplaint: input.chiefComplaint ?? current.reason ?? null,
          assignedPractitionerId: current.practitionerId,
        });
        await this.audit.record(tx, actor, {
          action: "appointment.check-in",
          resourceType: "appointment",
          resourceId: appointmentId,
          patientId: row.patientId,
          metadata: { visitId: row.id },
        });
        await this.events.record(tx, appointmentEvent("AppointmentCheckedIn", found(updated, "Appointment"), { visitId: row.id }), queueEvent(row));
        return toVisitView(row);
      }),
    );
  }

  /**
   * The patient joins the waiting room of an online consultation (from the
   * portal): the appointment is checked in and the visit goes straight to the
   * consultation queue. Idempotent — joining again returns the same visit.
   * Allowed from 30 minutes before the start until the appointment ends.
   */
  async checkInOnline(organizationId: string, appointmentId: string, now = new Date()): Promise<VisitRecord> {
    const actor = systemActor(organizationId, null, "telemedicine-waiting-room");
    return this.guardArrival(undefined, () =>
      this.db.transaction(async (tx) => {
        const [booked] = await tx
          .select()
          .from(appointment)
          .where(and(eq(appointment.organizationId, organizationId), eq(appointment.id, appointmentId)))
          .for("update");
        const current = found(booked, "Appointment");
        if (current.status === "checked_in") {
          const [existing] = await tx.select().from(visit).where(eq(visit.appointmentId, appointmentId));
          if (existing) return existing;
        }
        if (!canApply("check_in", current.status)) {
          throw new BusinessRuleError(`This consultation is ${current.status.replace(/_/g, " ")}`, "invalid_appointment_status");
        }
        if (now.getTime() < current.startsAt.getTime() - ONLINE_EARLY_JOIN_MS || now > current.endsAt) {
          throw new BusinessRuleError("The waiting room opens 30 minutes before the consultation", "outside_join_window");
        }
        const [updated] = await tx
          .update(appointment)
          .set({ status: "checked_in", checkedInAt: now, updatedAt: now, version: sql`${appointment.version} + 1` })
          .where(eq(appointment.id, appointmentId))
          .returning();
        const row = await this.insertVisit(tx, actor, current.facilityId, {
          patientId: current.patientId,
          appointmentId,
          visitTypeId: current.visitTypeId,
          arrivalMode: "appointment",
          priority: "routine",
          chiefComplaint: current.reason ?? null,
          assignedPractitionerId: current.practitionerId,
          viaPortal: true,
        });
        await this.audit.record(tx, actor, {
          action: "appointment.check-in",
          resourceType: "appointment",
          resourceId: appointmentId,
          patientId: row.patientId,
          metadata: { visitId: row.id, via: "patient_portal" },
        });
        await this.events.record(tx, appointmentEvent("AppointmentCheckedIn", found(updated, "Appointment"), { visitId: row.id }), queueEvent(row));
        return row;
      }),
    );
  }

  /** Today's queue (or another date) for the actor's facility, in service order. */
  async queue(actor: Actor, options: { date?: string; includeClosed?: boolean }): Promise<QueueEntryView[]> {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const date = options.date ?? localDate(new Date(), facility.timezone);
    const conditions = [eq(visit.organizationId, actor.organizationId), eq(visit.facilityId, facilityId), eq(visit.queueDate, date)];
    if (!options.includeClosed) conditions.push(inArray(visit.status, [...ACTIVE_VISIT_STATUSES]));
    const rows = await this.db
      .select()
      .from(visit)
      .where(and(...conditions));
    const patients = await this.patients.summaries(actor.organizationId, [...new Set(rows.map((r) => r.patientId))]);
    const visitIds = rows.map((r) => r.id);
    const encounters = visitIds.length
      ? await this.db
          .select({ id: encounter.id, visitId: encounter.visitId })
          .from(encounter)
          .where(and(eq(encounter.organizationId, actor.organizationId), inArray(encounter.visitId, visitIds), ne(encounter.status, "entered_in_error")))
      : [];
    const encounterByVisit = new Map(encounters.map((e) => [e.visitId, e.id]));
    const typeIds = [...new Set(rows.map((r) => r.visitTypeId))];
    const types = typeIds.length
      ? await this.db
          .select({ id: visitType.id, modality: visitType.modality })
          .from(visitType)
          .where(and(eq(visitType.organizationId, actor.organizationId), inArray(visitType.id, typeIds)))
      : [];
    const modalityByType = new Map(types.map((t) => [t.id, t.modality]));
    const now = Date.now();
    await this.audit.recordStandalone(actor, { action: "queue.view", resourceType: "visit", metadata: { facilityId, date, count: rows.length } });
    return rows.sort(compareQueueOrder).map((row) => ({
      ...toVisitView(row),
      patient: patients.get(row.patientId) ?? null,
      encounterId: encounterByVisit.get(row.id) ?? null,
      modality: modalityByType.get(row.visitTypeId) ?? "in_person",
      waitingMinutes: Math.max(0, Math.round(((row.consultationStartedAt ?? row.completedAt ?? new Date(now)).getTime() - row.checkedInAt.getTime()) / 60_000)),
    }));
  }

  async get(actor: Actor, visitId: string): Promise<VisitView> {
    return toVisitView(await this.find(this.db, actor.organizationId, visitId));
  }

  /** Moves a visit through triage/waiting states, or closes it without care (reason required). */
  async move(actor: Actor, visitId: string, input: z.infer<typeof moveVisitSchema>): Promise<VisitView> {
    if (requiresReason(input.status) && !input.reason) throw new BusinessRuleError("A reason is required", "reason_required");
    return this.update(actor, visitId, input.version, (current) => {
      if (!canTransition(current.status, input.status)) throw invalidMove(current.status, input.status);
      const closing = requiresReason(input.status);
      return {
        changes: {
          status: input.status,
          ...(input.status === "in_triage" && !current.triageStartedAt ? { triageStartedAt: new Date() } : {}),
          ...(closing ? { completedAt: new Date(), closedReason: input.reason ?? null } : {}),
        },
        action: `visit.${input.status.replace(/_/g, "-")}`,
        reason: input.reason,
      };
    });
  }

  /** "Calling" a patient to a room or counter, e.g. for a display board. */
  async call(actor: Actor, visitId: string, input: z.infer<typeof callVisitSchema>): Promise<VisitView> {
    return this.update(actor, visitId, input.version, (current) => {
      if (!ACTIVE_VISIT_STATUSES.includes(current.status)) throw new BusinessRuleError("The visit is closed", "visit_closed");
      return { changes: { calledAt: new Date(), calledTo: input.calledTo }, action: "visit.call" };
    });
  }

  async assign(actor: Actor, visitId: string, input: z.infer<typeof assignVisitSchema>): Promise<VisitView> {
    if (input.practitionerId) await this.config.requireActivePractitioner(actor.organizationId, input.practitionerId);
    return this.update(actor, visitId, input.version, (current) => {
      if (!ACTIVE_VISIT_STATUSES.includes(current.status)) throw new BusinessRuleError("The visit is closed", "visit_closed");
      return {
        changes: { assignedPractitionerId: input.practitionerId, ...(input.priority ? { priority: input.priority } : {}) },
        action: "visit.assign",
      };
    });
  }

  // ---- used by triage and encounters (same library) ---------------------------

  async lock(tx: DbExecutor, organizationId: string, visitId: string): Promise<VisitRecord> {
    const [row] = await tx
      .select()
      .from(visit)
      .where(and(eq(visit.organizationId, organizationId), eq(visit.id, visitId)))
      .for("update");
    return found(row, "Visit");
  }

  /** Applies a status change decided by another workflow step (triage, encounter start/sign). */
  async setStatus(tx: DbExecutor, row: VisitRecord, status: VisitStatus, extra: Partial<typeof visit.$inferInsert> = {}): Promise<VisitRecord> {
    if (row.status !== status && !canTransition(row.status, status)) throw invalidMove(row.status, status);
    const [updated] = await tx
      .update(visit)
      .set({ status, ...extra, updatedAt: new Date(), version: sql`${visit.version} + 1` })
      .where(eq(visit.id, row.id))
      .returning();
    const result = found(updated, "Visit");
    await this.events.record(tx, queueEvent(result));
    return result;
  }

  private async find(executor: DbExecutor, organizationId: string, visitId: string): Promise<VisitRecord> {
    const [row] = await executor
      .select()
      .from(visit)
      .where(and(eq(visit.organizationId, organizationId), eq(visit.id, visitId)));
    return found(row, "Visit");
  }

  private async update(
    actor: Actor,
    visitId: string,
    version: number,
    decide: (current: VisitRecord) => { changes: Partial<typeof visit.$inferInsert>; action: string; reason?: string },
  ): Promise<VisitView> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, visitId);
      if (actor.facilityId && current.facilityId !== actor.facilityId) throw new NotFoundError("Visit");
      assertVersion(current.version, version, "Visit");
      const { changes, action, reason } = decide(current);
      const [updated] = await tx
        .update(visit)
        .set({ ...changes, updatedAt: new Date(), version: sql`${visit.version} + 1` })
        .where(eq(visit.id, visitId))
        .returning();
      const row = found(updated, "Visit");
      await this.audit.record(tx, actor, {
        action,
        resourceType: "visit",
        resourceId: visitId,
        patientId: row.patientId,
        reason,
        changes: current.status !== row.status ? { status: { from: current.status, to: row.status } } : undefined,
      });
      await this.events.record(tx, queueEvent(row));
      return toVisitView(row);
    });
  }

  private async insertVisit(
    tx: DbExecutor,
    actor: Actor,
    facilityId: string,
    values: Pick<typeof visit.$inferInsert, "patientId" | "visitTypeId" | "arrivalMode" | "priority" | "chiefComplaint" | "assignedPractitionerId"> & {
      appointmentId?: string;
      /** Online check-in by the patient: no staff user, straight to the consultation queue (no triage). */
      viaPortal?: boolean;
    },
  ): Promise<VisitRecord> {
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const queueDate = localDate(new Date(), facility.timezone);
    // Per facility and day; the row lock serializes concurrent check-ins.
    const [counter] = await tx
      .insert(facilityQueueCounter)
      .values({ facilityId, queueDate, nextValue: 1 })
      .onConflictDoUpdate({
        target: [facilityQueueCounter.facilityId, facilityQueueCounter.queueDate],
        set: { nextValue: sql`${facilityQueueCounter.nextValue} + 1` },
      })
      .returning({ value: facilityQueueCounter.nextValue });
    const { viaPortal, ...fields } = values;
    const [row] = await tx
      .insert(visit)
      .values({
        ...fields,
        organizationId: actor.organizationId,
        facilityId,
        queueDate,
        queueNumber: found(counter, "Queue counter").value,
        checkedInBy: viaPortal ? null : actor.userId,
        checkedInVia: viaPortal ? "patient_portal" : "staff",
        status: viaPortal ? "awaiting_consultation" : "waiting",
      })
      .returning();
    return found(row, "Visit");
  }

  private async guardArrival<T>(patientId: string | undefined, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.code === PgErrorCode.uniqueViolation && pg.constraint === "visit_patient_active_uq") {
        throw new ConflictError("The patient is already in this facility’s queue", undefined, "already_in_queue");
      }
      if (pg?.code === PgErrorCode.foreignKeyViolation && patientId && pg.constraint?.includes("patient")) throw new NotFoundError("Patient");
      throw error;
    }
  }
}

const ONLINE_EARLY_JOIN_MS = 30 * 60_000;

function invalidMove(from: VisitStatus, to: VisitStatus): BusinessRuleError {
  return new BusinessRuleError(`Cannot move a visit from ${from.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}`, "invalid_queue_transition");
}
