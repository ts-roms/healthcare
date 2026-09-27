import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  dayOfWeek,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  localDayBounds,
  NotFoundError,
} from "@healthcare/core";
import { facility } from "@healthcare/organization";
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { patientBookSchema, patientCancelSchema, patientRescheduleSchema, patientSlotsSchema } from "../clinic.dto";
import { appointment, type AppointmentRecord, practitioner, practitionerSchedule, visitType } from "../clinic.schema";
import { assertVersion, found } from "../clinic-support";
import { canApply } from "../domain/appointment-state";
import { availableSlots, type Slot } from "../domain/availability";
import { PATIENT_BOOKING_RULES, patientBookingWindow, patientMayChange } from "../domain/patient-booking";
import { AppointmentService, appointmentEvent, invalidTransition, translateBookingError } from "./appointment.service";

/** The signed-in patient, as the portal passes them in. */
export interface PatientBookingContext {
  organizationId: string;
  patientId: string;
  audit: PatientAuditContext;
}

export interface BookableSlot {
  startsAt: Date;
  endsAt: Date;
  practitionerId: string;
  practitionerName: string;
}

const WINDOW_MESSAGES = {
  too_soon: `Online bookings must start at least ${PATIENT_BOOKING_RULES.minLeadMinutes / 60} hours from now — please call the clinic for an earlier visit`,
  too_far_ahead: `Online bookings can be made up to ${PATIENT_BOOKING_RULES.maxAdvanceDays} days ahead`,
} as const;

const DEFAULT_CANCEL_REASON = "Cancelled by the patient in MyHealth";

/**
 * Patients booking, rescheduling and cancelling their own appointments
 * (MyHealth). Only visit types the clinic has opened for online booking, only
 * inside published schedules, with notice and a limit on open bookings. The
 * database still guards against double-booking. No staff user is involved:
 * the rows are marked as the patient's and the audit trail records the patient.
 */
@Injectable()
export class PatientBookingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly appointments: AppointmentService,
  ) {}

  /** What can be booked online: facilities, visit types and the practitioners with published schedules at each facility. */
  async options(organizationId: string, now = new Date()) {
    const today = localDate(now, "Asia/Manila");
    const types = await this.db
      .select({ id: visitType.id, name: visitType.name, modality: visitType.modality, durationMinutes: visitType.defaultDurationMinutes })
      .from(visitType)
      .where(and(eq(visitType.organizationId, organizationId), eq(visitType.status, "active"), eq(visitType.onlineBooking, true)))
      .orderBy(asc(visitType.name));
    const schedules = await this.db
      .selectDistinct({
        facilityId: practitionerSchedule.facilityId,
        facilityName: facility.name,
        cityMunicipality: facility.cityMunicipality,
        timeZone: facility.timezone,
        practitionerId: practitioner.id,
        practitionerName: practitioner.displayName,
        specialty: practitioner.specialty,
      })
      .from(practitionerSchedule)
      .innerJoin(practitioner, eq(practitioner.id, practitionerSchedule.practitionerId))
      .innerJoin(facility, eq(facility.id, practitionerSchedule.facilityId))
      .where(
        and(
          eq(practitionerSchedule.organizationId, organizationId),
          eq(practitionerSchedule.status, "active"),
          or(isNull(practitionerSchedule.validUntil), gte(practitionerSchedule.validUntil, today)),
          eq(practitioner.status, "active"),
          eq(facility.status, "active"),
        ),
      )
      .orderBy(asc(facility.name), asc(practitioner.displayName));
    const facilities = new Map<string, { id: string; name: string; cityMunicipality: string | null; timeZone: string; practitioners: unknown[] }>();
    for (const row of schedules) {
      const entry = facilities.get(row.facilityId) ?? {
        id: row.facilityId,
        name: row.facilityName,
        cityMunicipality: row.cityMunicipality,
        timeZone: row.timeZone,
        practitioners: [],
      };
      entry.practitioners.push({ id: row.practitionerId, displayName: row.practitionerName, specialty: row.specialty });
      facilities.set(row.facilityId, entry);
    }
    return {
      visitTypes: types,
      facilities: types.length ? [...facilities.values()] : [],
      rules: PATIENT_BOOKING_RULES,
    };
  }

  /** Open slots on one local day at a facility, for one practitioner or all practitioners on duty. */
  async slots(organizationId: string, query: z.infer<typeof patientSlotsSchema>, now = new Date()) {
    const type = await this.bookableType(organizationId, query.visitTypeId);
    const site = await this.facility(organizationId, query.facilityId);
    const practitioners = await this.practitionersOnDuty(this.db, organizationId, query.facilityId, query.date, query.practitionerId);
    const slots: BookableSlot[] = [];
    for (const p of practitioners) {
      for (const slot of await this.openSlots(this.db, p.id, query.facilityId, site.timezone, query.date, type.defaultDurationMinutes, now)) {
        slots.push({ startsAt: slot.startsAt, endsAt: slot.endsAt, practitionerId: p.id, practitionerName: p.displayName });
      }
    }
    slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.practitionerName.localeCompare(b.practitionerName));
    return { date: query.date, timeZone: site.timezone, durationMinutes: type.defaultDurationMinutes, slots };
  }

  async book(ctx: PatientBookingContext, input: z.infer<typeof patientBookSchema>, now = new Date()) {
    const type = await this.bookableType(ctx.organizationId, input.visitTypeId);
    const site = await this.facility(ctx.organizationId, input.facilityId);
    const startsAt = new Date(input.startsAt);
    this.assertWindow(startsAt, now);
    try {
      return await this.db.transaction(async (tx) => {
        // One booking at a time per patient, so the open-booking limit holds under concurrent requests.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`patient-booking:${ctx.patientId}`}, 0))`);
        const [open] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(appointment)
          .where(
            and(
              eq(appointment.organizationId, ctx.organizationId),
              eq(appointment.patientId, ctx.patientId),
              eq(appointment.bookedByPatient, true),
              inArray(appointment.status, ["booked", "confirmed"]),
              gt(appointment.startsAt, now),
            ),
          );
        if ((open?.count ?? 0) >= PATIENT_BOOKING_RULES.maxUpcoming) {
          throw new BusinessRuleError(
            `You already have ${PATIENT_BOOKING_RULES.maxUpcoming} upcoming online bookings — cancel one or call the clinic`,
            "too_many_bookings",
          );
        }
        const slot = await this.requireOpenSlot(
          tx,
          ctx.organizationId,
          input.practitionerId,
          input.facilityId,
          site.timezone,
          startsAt,
          type.defaultDurationMinutes,
          now,
        );
        const [row] = await tx
          .insert(appointment)
          .values({
            organizationId: ctx.organizationId,
            facilityId: input.facilityId,
            patientId: ctx.patientId,
            practitionerId: input.practitionerId,
            roomId: slot.roomId,
            visitTypeId: input.visitTypeId,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            bookingChannel: "online",
            reason: input.reason ?? null,
            createdBy: null,
            updatedBy: null,
            bookedByPatient: true,
            updatedByPatient: true,
          })
          .returning();
        const booked = found(row, "Appointment");
        await this.audit.record(tx, ctx.audit, {
          action: "appointment.book",
          resourceType: "appointment",
          resourceId: booked.id,
          patientId: ctx.patientId,
          metadata: { practitionerId: booked.practitionerId, startsAt: booked.startsAt, via: "patient_portal" },
        });
        await this.events.record(tx, appointmentEvent("AppointmentBooked", booked, { bookedByPatient: true }));
        return this.patientView(booked);
      });
    } catch (error) {
      throw translateBookingError(error);
    }
  }

  async reschedule(ctx: PatientBookingContext, appointmentId: string, input: z.infer<typeof patientRescheduleSchema>, now = new Date()) {
    const startsAt = new Date(input.startsAt);
    this.assertWindow(startsAt, now);
    try {
      return await this.db.transaction(async (tx) => {
        const current = await this.lockOwn(tx, ctx, appointmentId);
        assertVersion(current.version, input.version, "Appointment");
        if (!canApply("reschedule", current.status)) throw invalidTransition("reschedule", current.status);
        this.assertMayChange(current, now);
        await this.bookableType(ctx.organizationId, current.visitTypeId);
        const site = await this.facility(ctx.organizationId, current.facilityId);
        const duration = Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000);
        const slot = await this.requireOpenSlot(
          tx,
          ctx.organizationId,
          current.practitionerId,
          current.facilityId,
          site.timezone,
          startsAt,
          duration,
          now,
          current,
        );
        const [updated] = await tx
          .update(appointment)
          .set({
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            roomId: slot.roomId,
            status: "booked",
            confirmedAt: null,
            updatedBy: null,
            updatedByPatient: true,
            updatedAt: now,
            version: sql`${appointment.version} + 1`,
          })
          .where(eq(appointment.id, appointmentId))
          .returning();
        const row = found(updated, "Appointment");
        await this.audit.record(tx, ctx.audit, {
          action: "appointment.reschedule",
          resourceType: "appointment",
          resourceId: appointmentId,
          patientId: ctx.patientId,
          changes: { startsAt: { from: current.startsAt, to: row.startsAt } },
          metadata: { via: "patient_portal" },
        });
        await this.events.record(
          tx,
          appointmentEvent("AppointmentRescheduled", row, { previousStartsAt: current.startsAt.toISOString(), changedByPatient: true }),
        );
        return this.patientView(row);
      });
    } catch (error) {
      throw translateBookingError(error);
    }
  }

  async cancel(ctx: PatientBookingContext, appointmentId: string, input: z.infer<typeof patientCancelSchema>, now = new Date()) {
    return this.db.transaction(async (tx) => {
      const current = await this.lockOwn(tx, ctx, appointmentId);
      assertVersion(current.version, input.version, "Appointment");
      if (!canApply("cancel", current.status)) throw invalidTransition("cancel", current.status);
      this.assertMayChange(current, now);
      const reason = input.reason ?? DEFAULT_CANCEL_REASON;
      const [updated] = await tx
        .update(appointment)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: null,
          cancellationReason: reason,
          updatedBy: null,
          updatedByPatient: true,
          updatedAt: now,
          version: sql`${appointment.version} + 1`,
        })
        .where(eq(appointment.id, appointmentId))
        .returning();
      const row = found(updated, "Appointment");
      await this.audit.record(tx, ctx.audit, {
        action: "appointment.cancel",
        resourceType: "appointment",
        resourceId: appointmentId,
        patientId: ctx.patientId,
        reason,
        changes: { status: { from: current.status, to: row.status } },
        metadata: { via: "patient_portal" },
      });
      await this.events.record(tx, appointmentEvent("AppointmentCancelled", row, { changedByPatient: true }));
      return this.patientView(row);
    });
  }

  // ---- internals ------------------------------------------------------------

  private patientView(row: AppointmentRecord) {
    return {
      id: row.id,
      facilityId: row.facilityId,
      practitionerId: row.practitionerId,
      visitTypeId: row.visitTypeId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status,
      reason: row.reason,
      version: row.version,
    };
  }

  private assertWindow(startsAt: Date, now: Date) {
    const refusal = patientBookingWindow(startsAt, now);
    if (refusal) throw new BusinessRuleError(WINDOW_MESSAGES[refusal], refusal === "too_soon" ? "booking_too_soon" : "booking_too_far_ahead");
  }

  private assertMayChange(current: AppointmentRecord, now: Date) {
    if (!patientMayChange(current.startsAt, now)) {
      throw new BusinessRuleError(
        `Online changes close ${PATIENT_BOOKING_RULES.changeCutoffMinutes / 60} hours before the appointment — please call the clinic`,
        "change_window_closed",
      );
    }
  }

  private async lockOwn(tx: DbExecutor, ctx: PatientBookingContext, appointmentId: string) {
    const [row] = await tx
      .select()
      .from(appointment)
      .where(and(eq(appointment.organizationId, ctx.organizationId), eq(appointment.id, appointmentId), eq(appointment.patientId, ctx.patientId)))
      .for("update");
    // Another patient's appointment is reported as not found, never as forbidden.
    return found(row, "Appointment");
  }

  private async bookableType(organizationId: string, visitTypeId: string) {
    const [row] = await this.db
      .select()
      .from(visitType)
      .where(and(eq(visitType.organizationId, organizationId), eq(visitType.id, visitTypeId)));
    if (!row || row.status !== "active" || !row.onlineBooking) {
      throw new BusinessRuleError("This kind of visit cannot be booked online — please call the clinic", "not_bookable_online");
    }
    return row;
  }

  private async facility(organizationId: string, facilityId: string) {
    const [row] = await this.db
      .select({ id: facility.id, timezone: facility.timezone, status: facility.status })
      .from(facility)
      .where(and(eq(facility.organizationId, organizationId), eq(facility.id, facilityId)));
    if (!row || row.status !== "active") throw new NotFoundError("Facility");
    return row;
  }

  private async practitionersOnDuty(executor: DbExecutor, organizationId: string, facilityId: string, date: string, practitionerId?: string) {
    const conditions = [
      eq(practitionerSchedule.organizationId, organizationId),
      eq(practitionerSchedule.facilityId, facilityId),
      eq(practitionerSchedule.status, "active"),
      eq(practitionerSchedule.dayOfWeek, dayOfWeek(date)),
      lte(practitionerSchedule.validFrom, date),
      or(isNull(practitionerSchedule.validUntil), gte(practitionerSchedule.validUntil, date)),
      eq(practitioner.status, "active"),
    ];
    if (practitionerId) conditions.push(eq(practitioner.id, practitionerId));
    return executor
      .selectDistinct({ id: practitioner.id, displayName: practitioner.displayName })
      .from(practitionerSchedule)
      .innerJoin(practitioner, eq(practitioner.id, practitionerSchedule.practitionerId))
      .where(and(...conditions));
  }

  /** Free slots for patients: the schedule's slot grid, minus leave, closures, bookings, and anything inside the notice period or beyond the horizon. */
  private async openSlots(
    executor: DbExecutor,
    practitionerId: string,
    facilityId: string,
    timeZone: string,
    date: string,
    durationMinutes: number,
    now: Date,
    ignore?: AppointmentRecord,
  ): Promise<Slot[]> {
    const { start, end } = localDayBounds(date, timeZone);
    const blocks = await this.appointments.scheduleBlocks(executor, practitionerId, facilityId, date);
    const booked = await this.appointments.bookedIntervals(executor, practitionerId, start, end);
    const unavailable = [
      ...(await this.appointments.exceptions(executor, facilityId, practitionerId, start, end)),
      // Moving an appointment must not collide with itself.
      ...booked.filter((b) => !ignore || b.start.getTime() !== ignore.startsAt.getTime() || b.end.getTime() !== ignore.endsAt.getTime()),
    ];
    const earliest = new Date(now.getTime() + PATIENT_BOOKING_RULES.minLeadMinutes * 60_000);
    const latest = now.getTime() + PATIENT_BOOKING_RULES.maxAdvanceDays * 86_400_000;
    return availableSlots({ date, timeZone, blocks, durationMinutes, unavailable, now: earliest }).filter((s) => s.startsAt.getTime() <= latest);
  }

  private async requireOpenSlot(
    tx: DbExecutor,
    organizationId: string,
    practitionerId: string,
    facilityId: string,
    timeZone: string,
    startsAt: Date,
    durationMinutes: number,
    now: Date,
    ignore?: AppointmentRecord,
  ): Promise<Slot> {
    const date = localDate(startsAt, timeZone);
    const onDuty = await this.practitionersOnDuty(tx, organizationId, facilityId, date, practitionerId);
    if (onDuty.length === 0) throw new NotFoundError("Practitioner");
    const slots = await this.openSlots(tx, practitionerId, facilityId, timeZone, date, durationMinutes, now, ignore);
    const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
    if (!slot) throw new ConflictError("That time is no longer available — please choose another", undefined, "slot_unavailable");
    return slot;
  }
}
