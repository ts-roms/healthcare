import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
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
  type Page,
  pageOffset,
  PgErrorCode,
  systemActor,
  toPage,
  filedAsPatient,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, gte, inArray, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type {
  BookAppointmentInput,
  cancelAppointmentSchema,
  closeWaitlistSchema,
  createWaitlistSchema,
  listAppointmentsSchema,
  rescheduleSchema,
} from "../clinic.dto";
import { appointment, type AppointmentRecord, practitionerSchedule, room, scheduleException, waitlistEntry } from "../clinic.schema";
import { assertVersion, found, publicView } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { PATIENT_DIRECTORY, type PatientBrief, type PatientDirectory } from "../ports";
import { canApply, noShowAllowed } from "../domain/appointment-state";
import { availableSlots, type Interval, type ScheduleBlock } from "../domain/availability";

const BLOCKING_STATUSES = ["cancelled", "no_show"] as const;

export type AppointmentView = Omit<AppointmentRecord, "organizationId">;

/** List rows carry minimal patient identification for schedules (no contact or clinical details). */
export type AppointmentListItem = AppointmentView & { patient: PatientBrief | null };

@Injectable()
export class AppointmentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly organizations: OrganizationService,
    private readonly config: ClinicConfigService,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  /** Free slots for a practitioner at a facility on a local date. */
  async availability(actor: Actor, query: { practitionerId: string; facilityId: string; visitTypeId: string; date: string }) {
    const facility = await this.organizations.getFacility(actor.organizationId, query.facilityId);
    const type = await this.config.requireActiveVisitType(actor.organizationId, query.visitTypeId);
    await this.config.requireActivePractitioner(actor.organizationId, query.practitionerId);
    const blocks = await this.scheduleBlocks(this.db, query.practitionerId, query.facilityId, query.date);
    const { start, end } = localDayBounds(query.date, facility.timezone);
    const unavailable = [
      ...(await this.exceptions(this.db, query.facilityId, query.practitionerId, start, end)),
      ...(await this.bookedIntervals(this.db, query.practitionerId, start, end)),
    ];
    const slots = availableSlots({
      date: query.date,
      timeZone: facility.timezone,
      blocks,
      durationMinutes: type.defaultDurationMinutes,
      unavailable,
      now: new Date(),
    });
    return { date: query.date, timeZone: facility.timezone, durationMinutes: type.defaultDurationMinutes, slots };
  }

  /**
   * Books an appointment (or a recurring series, all-or-nothing). The
   * database's exclusion constraints are the final guard against
   * double-booking a practitioner or room, even under concurrency.
   */
  async book(actor: Actor, input: BookAppointmentInput): Promise<AppointmentView[]> {
    const facility = await this.organizations.getFacility(actor.organizationId, input.facilityId);
    const type = await this.config.requireActiveVisitType(actor.organizationId, input.visitTypeId);
    await this.config.requireActivePractitioner(actor.organizationId, input.practitionerId);
    const duration = input.durationMinutes ?? type.defaultDurationMinutes;
    const first = new Date(input.startsAt);
    if (first < new Date(Date.now() - 5 * 60_000)) throw new BusinessRuleError("Appointments cannot start in the past", "start_in_past");
    const occurrences = input.recurrence?.occurrences ?? 1;
    const seriesId = occurrences > 1 ? crypto.randomUUID() : null;

    try {
      return await this.db.transaction(async (tx) => {
        const created: AppointmentRecord[] = [];
        for (let i = 0; i < occurrences; i++) {
          const startsAt = new Date(first.getTime() + i * (input.recurrence?.intervalDays ?? 0) * 86_400_000);
          const endsAt = new Date(startsAt.getTime() + duration * 60_000);
          if (!input.outsideSchedule) await this.assertWithinSchedule(tx, input.practitionerId, input.facilityId, facility.timezone, startsAt, endsAt);
          const [row] = await tx
            .insert(appointment)
            .values({
              organizationId: actor.organizationId,
              facilityId: input.facilityId,
              patientId: input.patientId,
              practitionerId: input.practitionerId,
              roomId: input.roomId ?? null,
              visitTypeId: input.visitTypeId,
              startsAt,
              endsAt,
              bookingChannel: input.bookingChannel,
              reason: input.reason ?? null,
              notes: input.notes ?? null,
              seriesId,
              createdBy: actor.userId,
              updatedBy: actor.userId,
            })
            .returning();
          const booked = found(row, "Appointment");
          created.push(booked);
          await this.audit.record(tx, actor, {
            action: "appointment.book",
            resourceType: "appointment",
            resourceId: booked.id,
            patientId: booked.patientId,
            metadata: { practitionerId: booked.practitionerId, startsAt: booked.startsAt, seriesId, outsideSchedule: input.outsideSchedule },
          });
          await this.events.record(tx, appointmentEvent("AppointmentBooked", booked));
        }
        if (input.waitlistEntryId) await this.fulfilWaitlist(tx, actor, input.waitlistEntryId, input.patientId, created[0]!.id);
        return created.map(publicView);
      });
    } catch (error) {
      throw translateBookingError(error, input.patientId);
    }
  }

  async get(actor: Actor, appointmentId: string): Promise<AppointmentView> {
    return publicView(await this.find(this.db, actor.organizationId, appointmentId));
  }

  async list(actor: Actor, query: z.infer<typeof listAppointmentsSchema>): Promise<Page<AppointmentListItem>> {
    const filters: SQL[] = [eq(appointment.organizationId, actor.organizationId)];
    if (query.facilityId) filters.push(eq(appointment.facilityId, query.facilityId));
    if (query.practitionerId) filters.push(eq(appointment.practitionerId, query.practitionerId));
    if (query.patientId) filters.push(filedAsPatient(appointment.patientId, query.patientId));
    if (query.status) filters.push(eq(appointment.status, query.status));
    if (query.roomId) filters.push(eq(appointment.roomId, query.roomId));
    if (query.date) {
      const timeZone = query.facilityId ? (await this.organizations.getFacility(actor.organizationId, query.facilityId)).timezone : "Asia/Manila";
      const { start, end } = localDayBounds(query.date, timeZone);
      filters.push(gte(appointment.startsAt, start), lt(appointment.startsAt, end));
    }
    if (query.from && query.to) filters.push(gte(appointment.startsAt, new Date(query.from)), lt(appointment.startsAt, new Date(query.to)));
    const rows = await this.db
      .select()
      .from(appointment)
      .where(and(...filters))
      .orderBy(asc(appointment.startsAt), asc(appointment.id))
      .limit(query.pageSize + 1)
      .offset(pageOffset(query));
    if (query.patientId) {
      await this.audit.recordStandalone(actor, { action: "appointment.list", resourceType: "appointment", patientId: query.patientId });
    }
    const page = toPage(rows, query);
    const patients = await this.patients.summaries(actor.organizationId, [...new Set(page.items.map((a) => a.patientId))]);
    const roomIds = [...new Set(page.items.map((a) => a.roomId).filter((id): id is string => Boolean(id)))];
    const rooms = roomIds.length
      ? new Map(
          (
            await this.db
              .select({ id: room.id, name: room.name })
              .from(room)
              .where(and(eq(room.organizationId, actor.organizationId), inArray(room.id, roomIds)))
          ).map((r) => [r.id, r.name]),
        )
      : new Map<string, string>();
    if (!query.patientId && page.items.length > 0) {
      // A schedule shows who is booked: record that patients were listed.
      await this.audit.recordStandalone(actor, {
        action: "appointment.list",
        resourceType: "appointment",
        metadata: { facilityId: query.facilityId, practitionerId: query.practitionerId, date: query.date, count: page.items.length },
      });
    }
    return {
      ...page,
      items: page.items.map((a) => ({
        ...publicView(a),
        patient: patients.get(a.patientId) ?? null,
        room: a.roomId ? { id: a.roomId, name: rooms.get(a.roomId) ?? "" } : null,
      })),
    };
  }

  async confirm(actor: Actor, appointmentId: string, version: number): Promise<AppointmentView> {
    return this.transition(actor, appointmentId, version, "confirm", { status: "confirmed", confirmedAt: new Date() }, "AppointmentConfirmed");
  }

  async cancel(actor: Actor, appointmentId: string, input: z.infer<typeof cancelAppointmentSchema>): Promise<AppointmentView> {
    return this.transition(
      actor,
      appointmentId,
      input.version,
      "cancel",
      { status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.userId, cancellationReason: input.reason },
      "AppointmentCancelled",
      input.reason,
    );
  }

  async markNoShow(actor: Actor, appointmentId: string, version: number): Promise<AppointmentView> {
    const current = await this.find(this.db, actor.organizationId, appointmentId);
    if (!noShowAllowed(current.startsAt, new Date()))
      throw new BusinessRuleError("A no-show can be recorded only after the start time", "too_early_for_no_show");
    return this.transition(actor, appointmentId, version, "no_show", { status: "no_show", noShowAt: new Date() }, "AppointmentNoShow");
  }

  /**
   * The platform marks an appointment nobody attended as a no-show (the facility's automatic no-shows, migration 0088).
   * Same transition, audit and `AppointmentNoShow` event as staff recording it; `null` when the appointment is no longer
   * booked or confirmed (someone checked the patient in or changed it meanwhile, or another runner got there first).
   */
  async markNoShowAutomatically(organizationId: string, facilityId: string, appointmentId: string, now = new Date()): Promise<AppointmentView | null> {
    const actor = systemActor(organizationId, facilityId, "automatic-no-show");
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, organizationId, appointmentId);
      if (!canApply("no_show", current.status) || current.endsAt > now) return null;
      const [updated] = await tx
        .update(appointment)
        .set({ status: "no_show", noShowAt: now, noShowAutomatic: true, updatedAt: now, version: sql`${appointment.version} + 1` })
        .where(eq(appointment.id, appointmentId))
        .returning();
      const row = found(updated, "Appointment");
      await this.audit.record(tx, actor, {
        action: "appointment.no-show",
        resourceType: "appointment",
        resourceId: appointmentId,
        patientId: row.patientId,
        changes: { status: { from: current.status, to: row.status } },
        metadata: { automatic: true },
      });
      await this.events.record(tx, appointmentEvent("AppointmentNoShow", row, { automatic: true }));
      return publicView(row);
    });
  }

  async reschedule(actor: Actor, appointmentId: string, input: z.infer<typeof rescheduleSchema>): Promise<AppointmentView> {
    try {
      return await this.db.transaction(async (tx) => {
        const current = await this.lock(tx, actor.organizationId, appointmentId);
        assertVersion(current.version, input.version, "Appointment");
        if (!canApply("reschedule", current.status)) throw invalidTransition("reschedule", current.status);
        const facility = await this.organizations.getFacility(actor.organizationId, current.facilityId);
        const practitionerId = input.practitionerId ?? current.practitionerId;
        if (input.practitionerId) await this.config.requireActivePractitioner(actor.organizationId, practitionerId);
        const duration = input.durationMinutes ?? (current.endsAt.getTime() - current.startsAt.getTime()) / 60_000;
        const startsAt = new Date(input.startsAt);
        const endsAt = new Date(startsAt.getTime() + duration * 60_000);
        if (startsAt < new Date()) throw new BusinessRuleError("Appointments cannot start in the past", "start_in_past");
        if (!input.outsideSchedule) await this.assertWithinSchedule(tx, practitionerId, current.facilityId, facility.timezone, startsAt, endsAt);
        const [updated] = await tx
          .update(appointment)
          .set({
            startsAt,
            endsAt,
            practitionerId,
            roomId: input.roomId === undefined ? current.roomId : input.roomId,
            status: "booked",
            confirmedAt: null,
            updatedBy: actor.userId,
            updatedByPatient: false,
            updatedAt: new Date(),
            version: sql`${appointment.version} + 1`,
          })
          .where(eq(appointment.id, appointmentId))
          .returning();
        const row = found(updated, "Appointment");
        await this.audit.record(tx, actor, {
          action: "appointment.reschedule",
          resourceType: "appointment",
          resourceId: appointmentId,
          patientId: row.patientId,
          reason: input.reason,
          changes: {
            startsAt: { from: current.startsAt, to: row.startsAt },
            ...(practitionerId !== current.practitionerId ? { practitionerId: { from: current.practitionerId, to: practitionerId } } : {}),
          },
        });
        await this.events.record(tx, appointmentEvent("AppointmentRescheduled", row, { previousStartsAt: current.startsAt.toISOString() }));
        return publicView(row);
      });
    } catch (error) {
      throw translateBookingError(error);
    }
  }

  // ---- waitlist -------------------------------------------------------------

  async listWaitlist(actor: Actor, facilityId: string, now = new Date()) {
    const site = (await this.organizations.getFacility(actor.organizationId, facilityId)).timezone;
    const rows = await this.db
      .select()
      .from(waitlistEntry)
      .where(
        and(
          eq(waitlistEntry.organizationId, actor.organizationId),
          eq(waitlistEntry.facilityId, facilityId),
          eq(waitlistEntry.status, "waiting"),
          // Days that have passed are no longer waiting.
          gte(waitlistEntry.latestDate, localDate(now, site)),
        ),
      )
      .orderBy(sql`${waitlistEntry.priority} = 'soon' DESC`, asc(waitlistEntry.createdAt));
    const patients = await this.patients.summaries(actor.organizationId, [...new Set(rows.map((r) => r.patientId))]);
    return rows.map((row) => ({ ...publicView(row), patient: patients.get(row.patientId) ?? null }));
  }

  async addToWaitlist(actor: Actor, input: z.infer<typeof createWaitlistSchema>) {
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(waitlistEntry)
          .values({ ...input, organizationId: actor.organizationId, createdBy: actor.userId })
          .returning();
        const row = found(created, "Waitlist entry");
        await this.audit.record(tx, actor, {
          action: "waitlist.add",
          resourceType: "appointment_waitlist_entry",
          resourceId: row.id,
          patientId: row.patientId,
        });
        return publicView(row);
      });
    } catch (error) {
      throw translateBookingError(error, input.patientId);
    }
  }

  async closeWaitlistEntry(actor: Actor, entryId: string, input: z.infer<typeof closeWaitlistSchema>) {
    return this.db.transaction(async (tx) => {
      const [closed] = await tx
        .update(waitlistEntry)
        .set({ status: "cancelled", closedAt: new Date(), closedBy: actor.userId, closeReason: input.reason })
        .where(and(eq(waitlistEntry.organizationId, actor.organizationId), eq(waitlistEntry.id, entryId), eq(waitlistEntry.status, "waiting")))
        .returning();
      if (!closed) throw new NotFoundError("Waiting list entry");
      await this.audit.record(tx, actor, {
        action: "waitlist.close",
        resourceType: "appointment_waitlist_entry",
        resourceId: entryId,
        patientId: closed.patientId,
        reason: input.reason,
      });
      return publicView(closed);
    });
  }

  // ---- internals ------------------------------------------------------------

  async find(executor: DbExecutor, organizationId: string, appointmentId: string): Promise<AppointmentRecord> {
    const [row] = await executor
      .select()
      .from(appointment)
      .where(and(eq(appointment.organizationId, organizationId), eq(appointment.id, appointmentId)));
    return found(row, "Appointment");
  }

  async lock(executor: DbExecutor, organizationId: string, appointmentId: string): Promise<AppointmentRecord> {
    const [row] = await executor
      .select()
      .from(appointment)
      .where(and(eq(appointment.organizationId, organizationId), eq(appointment.id, appointmentId)))
      .for("update");
    return found(row, "Appointment");
  }

  private async transition(
    actor: Actor,
    appointmentId: string,
    version: number,
    action: "confirm" | "cancel" | "no_show",
    changes: Partial<typeof appointment.$inferInsert>,
    eventType: string,
    reason?: string,
  ): Promise<AppointmentView> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, appointmentId);
      assertVersion(current.version, version, "Appointment");
      if (!canApply(action, current.status)) throw invalidTransition(action, current.status);
      const [updated] = await tx
        .update(appointment)
        .set({ ...changes, updatedBy: actor.userId, updatedByPatient: false, updatedAt: new Date(), version: sql`${appointment.version} + 1` })
        .where(eq(appointment.id, appointmentId))
        .returning();
      const row = found(updated, "Appointment");
      await this.audit.record(tx, actor, {
        action: `appointment.${action.replace("_", "-")}`,
        resourceType: "appointment",
        resourceId: appointmentId,
        patientId: row.patientId,
        reason,
        changes: { status: { from: current.status, to: row.status } },
      });
      await this.events.record(tx, appointmentEvent(eventType, row));
      return publicView(row);
    });
  }

  async scheduleBlocks(executor: DbExecutor, practitionerId: string, facilityId: string, date: string): Promise<ScheduleBlock[]> {
    const rows = await executor
      .select()
      .from(practitionerSchedule)
      .where(
        and(
          eq(practitionerSchedule.practitionerId, practitionerId),
          eq(practitionerSchedule.facilityId, facilityId),
          eq(practitionerSchedule.status, "active"),
          eq(practitionerSchedule.dayOfWeek, dayOfWeek(date)),
          lte(practitionerSchedule.validFrom, date),
          or(isNull(practitionerSchedule.validUntil), gte(practitionerSchedule.validUntil, date)),
        ),
      );
    return rows.map((r) => ({ startTime: r.startTime, endTime: r.endTime, slotMinutes: r.slotMinutes, roomId: r.roomId }));
  }

  async exceptions(executor: DbExecutor, facilityId: string, practitionerId: string, from: Date, to: Date): Promise<Interval[]> {
    const rows = await executor
      .select({ start: scheduleException.startsAt, end: scheduleException.endsAt })
      .from(scheduleException)
      .where(
        and(
          eq(scheduleException.facilityId, facilityId),
          or(isNull(scheduleException.practitionerId), eq(scheduleException.practitionerId, practitionerId)),
          lt(scheduleException.startsAt, to),
          sql`${scheduleException.endsAt} > ${from.toISOString()}::timestamptz`,
        ),
      );
    return rows;
  }

  async bookedIntervals(executor: DbExecutor, practitionerId: string, from: Date, to: Date): Promise<Interval[]> {
    return executor
      .select({ start: appointment.startsAt, end: appointment.endsAt })
      .from(appointment)
      .where(
        and(
          eq(appointment.practitionerId, practitionerId),
          notInArray(appointment.status, [...BLOCKING_STATUSES]),
          lt(appointment.startsAt, to),
          sql`${appointment.endsAt} > ${from.toISOString()}::timestamptz`,
        ),
      );
  }

  /** The appointment must fall inside a published schedule block and not in a closure or leave. */
  async assertWithinSchedule(executor: DbExecutor, practitionerId: string, facilityId: string, timeZone: string, startsAt: Date, endsAt: Date) {
    const date = localDate(startsAt, timeZone);
    const blocks = await this.scheduleBlocks(executor, practitionerId, facilityId, date);
    const fits = availableSlots({
      date,
      timeZone,
      blocks: blocks.map((b) => ({ ...b, slotMinutes: 1 })),
      durationMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
      unavailable: [],
      now: new Date(0),
    }).some((slot) => slot.startsAt.getTime() === startsAt.getTime());
    if (!fits) {
      throw new BusinessRuleError("The time is outside the practitioner’s schedule at this facility", "outside_schedule", { date });
    }
    const closures = await this.exceptions(executor, facilityId, practitionerId, startsAt, endsAt);
    if (closures.length > 0) throw new BusinessRuleError("The practitioner or facility is unavailable at that time", "practitioner_unavailable");
  }

  private async fulfilWaitlist(tx: DbExecutor, actor: Actor, entryId: string, patientId: string, appointmentId: string) {
    const [updated] = await tx
      .update(waitlistEntry)
      .set({ status: "booked", appointmentId, closedAt: new Date(), closedBy: actor.userId })
      .where(
        and(
          eq(waitlistEntry.organizationId, actor.organizationId),
          eq(waitlistEntry.id, entryId),
          eq(waitlistEntry.patientId, patientId),
          eq(waitlistEntry.status, "waiting"),
        ),
      )
      .returning({ id: waitlistEntry.id });
    if (!updated) throw new NotFoundError("Waiting list entry for this patient");
  }
}

export function appointmentEvent(type: string, row: AppointmentRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "appointment",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: { practitionerId: row.practitionerId, visitTypeId: row.visitTypeId, startsAt: row.startsAt.toISOString(), status: row.status, ...extra },
  };
}

export function invalidTransition(action: string, status: string): BusinessRuleError {
  return new BusinessRuleError(`Cannot ${action.replace("_", "-")} an appointment that is ${status.replace("_", " ")}`, "invalid_appointment_status");
}

export function translateBookingError(error: unknown, patientId?: string): unknown {
  const pg = asPgError(error);
  if (pg?.code === PgErrorCode.exclusionViolation) {
    const what = pg.constraint === "appointment_room_no_overlap" ? "room" : "practitioner";
    return new ConflictError(`The ${what} is already booked at that time`, { constraint: pg.constraint }, "slot_unavailable");
  }
  if (pg?.code === PgErrorCode.foreignKeyViolation && patientId && pg.constraint?.includes("patient")) return new NotFoundError("Patient");
  return error;
}
