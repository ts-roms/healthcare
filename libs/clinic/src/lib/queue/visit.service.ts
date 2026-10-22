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
import type { assignVisitSchema, callVisitSchema, checkInSchema, moveVisitSchema, routeVisitSchema, walkInSchema } from "../clinic.dto";
import {
  appointment,
  encounter,
  facilityQueueCounter,
  type Modality,
  visit,
  type VisitRecord,
  visitRouting,
  visitType,
  type VisitStatus,
} from "../clinic.schema";
import { assertVersion, found, publicView } from "../clinic-support";
import { BookingRulesService } from "../config/booking-rules.service";
import { ClinicConfigService } from "../config/clinic-config.service";
import { type ServicePointBrief, ServicePointService } from "../config/service-point.service";
import { loadRouteSteps, type RouteStepView, toRouteStepViews } from "./visit-route.queries";
import type { PatientBookingContext } from "../appointments/patient-booking.service";
import { onlineCheckInWindow } from "../domain/patient-booking";
import { appointmentEvent } from "../appointments/appointment.service";
import { canApply } from "../domain/appointment-state";
import {
  ACTIVE_VISIT_STATUSES,
  canRouteVisit,
  canTransition,
  compareQueueOrder,
  SENIOR_AGE,
  type QueueDisplayCall,
  queueDisplay,
  queueTicket,
  requiresReason,
} from "../domain/queue-state";
import { PATIENT_DIRECTORY, type PatientBrief, type PatientDirectory } from "../ports";

export type VisitView = Omit<VisitRecord, "organizationId"> & { ticket: string };

export interface QueueEntryView extends VisitView {
  patient: PatientBrief | null;
  waitingMinutes: number;
  /** The visit's consultation, once started (encounters entered in error are ignored). */
  encounterId: string | null;
  /** From the visit type: an online visit is started from Telemedicine, not with an ordinary consultation. */
  modality: Modality;
  /** Where the visit is (migration 0113); null = the facility's consultation line. */
  servicePoint: ServicePointBrief | null;
  /** The visit's route (migration 0115), in order; empty when none was planned. */
  route: RouteStepView[];
}

/** One move of a visit between service points, oldest first (`GET /queue/visits/:id/routing`). */
export interface VisitRoutingView {
  id: string;
  from: ServicePointBrief | null;
  to: ServicePointBrief | null;
  routedBy: string;
  reason: string | null;
  routedAt: Date;
}

/** The waiting-room display (migration 0112): no patient detail, no visit id, no priority. */
export interface QueueDisplayView {
  facilityName: string;
  /** The facility's local date the display shows. */
  date: string;
  timeZone: string;
  calls: QueueDisplayCall[];
  waiting: number;
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
    payload: {
      status: row.status,
      queueNumber: row.queueNumber,
      queueDate: row.queueDate,
      priority: row.priority,
      calledTo: row.calledTo,
      servicePointId: row.servicePointId,
    },
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
    private readonly bookingRules: BookingRulesService,
    private readonly servicePoints: ServicePointService,
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

  /**
   * The patient checks in for their own in-person appointment in MyHealth (docs/domains/clinic.md, "Automatic no-shows
   * and online check-in"), where the facility offers it and within its window. The visit joins the queue waiting for
   * triage like any arrival, marked as checked in online. Checking in again returns the same visit.
   */
  async checkInByPatient(ctx: PatientBookingContext, appointmentId: string, now = new Date()): Promise<VisitView> {
    const actor = systemActor(ctx.organizationId, null, "patient-online-check-in");
    const row = await this.guardArrival(undefined, () =>
      this.db.transaction(async (tx) => {
        const [booked] = await tx
          .select()
          .from(appointment)
          .where(and(eq(appointment.organizationId, ctx.organizationId), eq(appointment.id, appointmentId), eq(appointment.patientId, ctx.patientId)))
          .for("update");
        // Another patient's appointment is reported as not found, never as forbidden.
        const current = found(booked, "Appointment");
        if (current.status === "checked_in") {
          const [existing] = await tx.select().from(visit).where(eq(visit.appointmentId, appointmentId));
          if (existing) return existing;
        }
        const [type] = await tx.select({ modality: visitType.modality }).from(visitType).where(eq(visitType.id, current.visitTypeId));
        if (type?.modality !== "in_person") {
          throw new BusinessRuleError("Online consultations are joined from their own page", "not_in_person");
        }
        if (!canApply("check_in", current.status)) {
          throw new BusinessRuleError(`This appointment is ${current.status.replace(/_/g, " ")}`, "invalid_appointment_status");
        }
        const rules = await this.bookingRules.forFacility(ctx.organizationId, current.facilityId, tx);
        const refusal = onlineCheckInWindow(current.startsAt, now, rules);
        if (refusal === "not_offered")
          throw new BusinessRuleError("This clinic does not offer online check-in — please check in at the desk", "online_check_in_not_offered");
        if (refusal === "too_early") {
          throw new BusinessRuleError(`Online check-in opens ${rules.checkInOpensMinutes} minutes before your appointment`, "check_in_too_early");
        }
        if (refusal === "too_late")
          throw new BusinessRuleError("Online check-in has closed for this appointment — please check in at the desk", "check_in_too_late");
        const [updated] = await tx
          .update(appointment)
          .set({ status: "checked_in", checkedInAt: now, updatedBy: null, updatedByPatient: true, updatedAt: now, version: sql`${appointment.version} + 1` })
          .where(eq(appointment.id, appointmentId))
          .returning();
        const inserted = await this.insertVisit(tx, actor, current.facilityId, {
          patientId: current.patientId,
          appointmentId,
          visitTypeId: current.visitTypeId,
          arrivalMode: "appointment",
          priority: "routine",
          chiefComplaint: current.reason ?? null,
          assignedPractitionerId: current.practitionerId,
          byPatient: true,
        });
        await this.audit.record(tx, ctx.audit, {
          action: "appointment.check-in",
          resourceType: "appointment",
          resourceId: appointmentId,
          patientId: inserted.patientId,
          metadata: { visitId: inserted.id, via: "patient_portal" },
        });
        await this.events.record(
          tx,
          appointmentEvent("AppointmentCheckedIn", found(updated, "Appointment"), { visitId: inserted.id, byPatient: true }),
          queueEvent(inserted),
        );
        return inserted;
      }),
    );
    return toVisitView(row);
  }

  /**
   * Today's queue (or another date) for the actor's facility, in service order; with `servicePointId`, only the
   * visits at that service point (the same order — a service point's queue is the facility queue filtered to it).
   */
  async queue(actor: Actor, options: { date?: string; includeClosed?: boolean; servicePointId?: string }): Promise<QueueEntryView[]> {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const date = options.date ?? localDate(new Date(), facility.timezone);
    const conditions = [eq(visit.organizationId, actor.organizationId), eq(visit.facilityId, facilityId), eq(visit.queueDate, date)];
    if (!options.includeClosed) conditions.push(inArray(visit.status, [...ACTIVE_VISIT_STATUSES]));
    if (options.servicePointId) conditions.push(eq(visit.servicePointId, options.servicePointId));
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
    const routes = await loadRouteSteps(
      this.db,
      actor.organizationId,
      rows.map((r) => r.id),
    );
    const servicePoints = await this.servicePoints.briefs(actor.organizationId, [
      ...rows.flatMap((r) => (r.servicePointId ? [r.servicePointId] : [])),
      ...[...routes.values()].flat().map((s) => s.servicePointId),
    ]);
    const now = Date.now();
    await this.audit.recordStandalone(actor, {
      action: "queue.view",
      resourceType: "visit",
      metadata: { facilityId, date, count: rows.length, ...(options.servicePointId ? { servicePointId: options.servicePointId } : {}) },
    });
    const seniorsFirst = (await this.servicePoints.settings(actor.organizationId, facilityId)).seniorsFirst;
    const isSenior = (patientId: string) => seniorsFirst && (patients.get(patientId)?.age ?? 0) >= SENIOR_AGE;
    return rows
      .map((row) => ({ row, senior: isSenior(row.patientId) }))
      .sort((a, b) => compareQueueOrder({ ...a.row, senior: a.senior }, { ...b.row, senior: b.senior }))
      .map(({ row }) => ({
        ...toVisitView(row),
        patient: patients.get(row.patientId) ?? null,
        encounterId: encounterByVisit.get(row.id) ?? null,
        modality: modalityByType.get(row.visitTypeId) ?? "in_person",
        servicePoint: (row.servicePointId && servicePoints.get(row.servicePointId)) || null,
        route: toRouteStepViews(routes.get(row.id) ?? [], servicePoints),
        waitingMinutes: Math.max(
          0,
          Math.round(((row.consultationStartedAt ?? row.completedAt ?? new Date(now)).getTime() - row.checkedInAt.getTime()) / 60_000),
        ),
      }));
  }

  /**
   * The waiting-room display for the actor's facility today: tickets called and where to go, and how many wait. It
   * holds no patient detail, so reading it is not audited (the full queue read is).
   */
  async display(actor: Actor): Promise<QueueDisplayView> {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const date = localDate(new Date(), facility.timezone);
    const rows = await this.db
      .select({ queueNumber: visit.queueNumber, status: visit.status, calledAt: visit.calledAt, calledTo: visit.calledTo, modality: visitType.modality })
      .from(visit)
      .innerJoin(visitType, and(eq(visitType.organizationId, visit.organizationId), eq(visitType.id, visit.visitTypeId)))
      .where(
        and(
          eq(visit.organizationId, actor.organizationId),
          eq(visit.facilityId, facilityId),
          eq(visit.queueDate, date),
          inArray(visit.status, [...ACTIVE_VISIT_STATUSES]),
        ),
      );
    const { calls, waiting } = queueDisplay(rows.map((r) => ({ ...r, inPerson: r.modality === "in_person" })));
    return { facilityName: facility.name, date, timeZone: facility.timezone, calls, waiting };
  }

  /** One visit, with the modality of its visit type and its consultation (as the queue board rows carry them). */
  async get(actor: Actor, visitId: string): Promise<VisitView & { modality: Modality; encounterId: string | null }> {
    const row = await this.find(this.db, actor.organizationId, visitId);
    const [type] = await this.db
      .select({ modality: visitType.modality })
      .from(visitType)
      .where(and(eq(visitType.organizationId, actor.organizationId), eq(visitType.id, row.visitTypeId)));
    const [consultation] = await this.db
      .select({ id: encounter.id })
      .from(encounter)
      .where(and(eq(encounter.organizationId, actor.organizationId), eq(encounter.visitId, row.id), ne(encounter.status, "entered_in_error")));
    return { ...toVisitView(row), modality: type?.modality ?? "in_person", encounterId: consultation?.id ?? null };
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
          // The patient has moved on: the call to the previous place no longer applies (nor on the waiting-room display).
          ...(input.status !== current.status ? { calledAt: null, calledTo: null } : {}),
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

  /**
   * Sends the visit to a service point of its facility (migration 0113): from the queue board, after triage. The
   * move is one row of the visit's routing history, written with the change.
   */
  async route(actor: Actor, visitId: string, input: z.infer<typeof routeVisitSchema>): Promise<VisitView> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, visitId);
      if (actor.facilityId && current.facilityId !== actor.facilityId) throw new NotFoundError("Visit");
      assertVersion(current.version, input.version, "Visit");
      if (current.servicePointId === input.servicePointId) {
        throw new BusinessRuleError("The patient is already at that service point", "already_at_service_point");
      }
      return toVisitView(await this.routeIn(tx, actor, current, input.servicePointId, input.reason));
    });
  }

  /** The visit's moves between service points, oldest first, with the service points' names. */
  async routingHistory(actor: Actor, visitId: string): Promise<VisitRoutingView[]> {
    const current = await this.find(this.db, actor.organizationId, visitId);
    if (actor.facilityId && current.facilityId !== actor.facilityId) throw new NotFoundError("Visit");
    const rows = await this.db
      .select()
      .from(visitRouting)
      .where(and(eq(visitRouting.organizationId, actor.organizationId), eq(visitRouting.visitId, visitId)))
      .orderBy(visitRouting.routedAt, visitRouting.id);
    const briefs = await this.servicePoints.briefs(
      actor.organizationId,
      rows.flatMap((r) => [r.toServicePointId, ...(r.fromServicePointId ? [r.fromServicePointId] : [])]),
    );
    return rows.map((r) => ({
      id: r.id,
      from: (r.fromServicePointId && briefs.get(r.fromServicePointId)) || null,
      to: briefs.get(r.toServicePointId) ?? null,
      routedBy: r.routedBy,
      reason: r.reason,
      routedAt: r.routedAt,
    }));
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

  /**
   * Routes a locked visit to an active service point of its facility in the caller's transaction (triage, or the
   * route command): appends the routing row, moves the visit, audits `visit.route` and records `VisitRouted` with the
   * queue update. The caller decides whether an unchanged target is a refusal (the command) or nothing to do (triage).
   */
  async routeIn(tx: DbExecutor, actor: Actor, row: VisitRecord, servicePointId: string, reason?: string): Promise<VisitRecord> {
    if (!canRouteVisit(row.status)) {
      throw new BusinessRuleError(`A visit that is ${row.status.replace(/_/g, " ")} cannot be sent to a service point`, "visit_not_routable");
    }
    const target = await this.servicePoints.requireActive(tx, actor.organizationId, row.facilityId, servicePointId);
    const [routing] = await tx
      .insert(visitRouting)
      .values({
        organizationId: actor.organizationId,
        facilityId: row.facilityId,
        visitId: row.id,
        patientId: row.patientId,
        fromServicePointId: row.servicePointId,
        toServicePointId: target.id,
        routedBy: actor.userId,
        reason: reason ?? null,
      })
      .returning();
    const routingId = found(routing, "Visit routing").id;
    const [updated] = await tx
      .update(visit)
      .set({ servicePointId: target.id, updatedAt: new Date(), version: sql`${visit.version} + 1` })
      .where(eq(visit.id, row.id))
      .returning();
    const result = found(updated, "Visit");
    await this.audit.record(tx, actor, {
      action: "visit.route",
      resourceType: "visit",
      resourceId: row.id,
      patientId: row.patientId,
      reason,
      changes: { servicePointId: { from: row.servicePointId, to: target.id } },
      metadata: { routingId, toCode: target.code },
    });
    await this.events.record(
      tx,
      {
        type: "VisitRouted",
        organizationId: row.organizationId,
        aggregateType: "visit",
        aggregateId: row.id,
        facilityId: row.facilityId,
        patientId: row.patientId,
        payload: { routingId, fromServicePointId: row.servicePointId, toServicePointId: target.id },
      },
      queueEvent(result),
    );
    return result;
  }

  /**
   * Calls a locked, open visit to a place in the caller's transaction (a route sending the patient on, migration
   * 0115): the same `called_at` / `called_to` as the board's call, audited `visit.call` with the given metadata, and
   * the same queue update — so the waiting-room display shows and announces it with no change there.
   */
  async callIn(tx: DbExecutor, actor: Actor, row: VisitRecord, calledTo: string, metadata: Record<string, unknown>): Promise<VisitRecord> {
    if (!ACTIVE_VISIT_STATUSES.includes(row.status)) throw new BusinessRuleError("The visit is closed", "visit_closed");
    const [updated] = await tx
      .update(visit)
      .set({ calledAt: new Date(), calledTo, updatedAt: new Date(), version: sql`${visit.version} + 1` })
      .where(eq(visit.id, row.id))
      .returning();
    const result = found(updated, "Visit");
    await this.audit.record(tx, actor, { action: "visit.call", resourceType: "visit", resourceId: row.id, patientId: row.patientId, metadata });
    await this.events.record(tx, queueEvent(result));
    return result;
  }

  /** Applies a status change decided by another workflow step (triage, encounter start/sign). */
  async setStatus(tx: DbExecutor, row: VisitRecord, status: VisitStatus, extra: Partial<typeof visit.$inferInsert> = {}): Promise<VisitRecord> {
    if (row.status !== status && !canTransition(row.status, status)) throw invalidMove(row.status, status);
    const [updated] = await tx
      .update(visit)
      .set({
        status,
        ...(row.status !== status ? { calledAt: null, calledTo: null } : {}),
        ...extra,
        updatedAt: new Date(),
        version: sql`${visit.version} + 1`,
      })
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
      /** Online consultation joined by the patient: no staff user, straight to the consultation queue (no triage). */
      viaPortal?: boolean;
      /** In-person appointment checked in by the patient in MyHealth: no staff user, waiting for triage like any arrival. */
      byPatient?: boolean;
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
    const { viaPortal, byPatient, ...fields } = values;
    const patientCheckedIn = viaPortal || byPatient;
    const [row] = await tx
      .insert(visit)
      .values({
        ...fields,
        organizationId: actor.organizationId,
        facilityId,
        queueDate,
        queueNumber: found(counter, "Queue counter").value,
        checkedInBy: patientCheckedIn ? null : actor.userId,
        checkedInVia: patientCheckedIn ? "patient_portal" : "staff",
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
