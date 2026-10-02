import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  dayOfWeek,
  filedAsPatient,
  localDate,
  localDayBounds,
  NotFoundError,
} from "@healthcare/core";
import { facility } from "@healthcare/organization";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { patientWaitlistJoinSchema } from "../clinic.dto";
import { practitioner, practitionerSchedule, visitType, waitlistEntry } from "../clinic.schema";
import { found } from "../clinic-support";
import { BookingRulesService } from "../config/booking-rules.service";
import { WaitlistRulesService } from "../config/waitlist-rules.service";
import { availableSlots } from "../domain/availability";
import { type BookingRules, waitlistRangeProblem } from "../domain/patient-booking";
import { AppointmentService } from "./appointment.service";
import type { PatientBookingContext } from "./patient-booking.service";

export interface PatientWaitlistEntry {
  id: string;
  facilityId: string;
  facilityName: string;
  visitTypeId: string | null;
  visitTypeName: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  earliestDate: string;
  latestDate: string;
  createdAt: Date;
}

const RANGE_MESSAGES = {
  invalid_range: "The last day cannot be before the first day.",
  in_the_past: "Choose days from today onwards.",
  too_wide: "Choose at most two weeks.",
  too_far_ahead: "That is further ahead than this clinic takes online requests.",
} as const;

/**
 * A patient's waiting list for full days (MyHealth; docs/domains/clinic.md). Where the clinic allows it (a facility booking
 * rule), a patient whose chosen days have no open times may ask to be told when one opens: a text or email says a time may
 * have opened and to sign in and book it, first come first served. Nothing is booked for the patient. The clinic sees the
 * entry on its own waiting list, marked as made by the patient.
 */
@Injectable()
export class PatientWaitlistService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly rules: BookingRulesService,
    private readonly waitlistRules: WaitlistRulesService,
    private readonly appointments: AppointmentService,
  ) {}

  /** The patient's entries still waiting (a day range that has passed is no longer waiting). */
  async list(ctx: PatientBookingContext, now = new Date()): Promise<PatientWaitlistEntry[]> {
    const rows = await this.db
      .select({
        entry: waitlistEntry,
        facilityName: facility.name,
        timeZone: facility.timezone,
        visitTypeName: visitType.name,
        practitionerName: practitioner.displayName,
      })
      .from(waitlistEntry)
      .innerJoin(facility, eq(facility.id, waitlistEntry.facilityId))
      .leftJoin(visitType, eq(visitType.id, waitlistEntry.visitTypeId))
      .leftJoin(practitioner, eq(practitioner.id, waitlistEntry.practitionerId))
      .where(
        and(
          eq(waitlistEntry.organizationId, ctx.organizationId),
          filedAsPatient(waitlistEntry.patientId, ctx.patientId),
          eq(waitlistEntry.status, "waiting"),
          eq(waitlistEntry.createdByPatient, true),
        ),
      )
      .orderBy(asc(waitlistEntry.earliestDate), asc(waitlistEntry.createdAt));
    return rows
      .filter((r) => r.entry.latestDate >= localDate(now, r.timeZone))
      .map((r) => ({
        id: r.entry.id,
        facilityId: r.entry.facilityId,
        facilityName: r.facilityName,
        visitTypeId: r.entry.visitTypeId,
        visitTypeName: r.visitTypeName,
        practitionerId: r.entry.practitionerId,
        practitionerName: r.practitionerName,
        earliestDate: r.entry.earliestDate,
        latestDate: r.entry.latestDate,
        createdAt: r.entry.createdAt,
      }));
  }

  async join(ctx: PatientBookingContext, input: z.infer<typeof patientWaitlistJoinSchema>, now = new Date()): Promise<PatientWaitlistEntry> {
    const [site] = await this.db
      .select({ id: facility.id, name: facility.name, timezone: facility.timezone, status: facility.status })
      .from(facility)
      .where(and(eq(facility.organizationId, ctx.organizationId), eq(facility.id, input.facilityId)));
    if (!site || site.status !== "active") throw new NotFoundError("Facility");
    const rules = await this.rules.forFacility(ctx.organizationId, input.facilityId);
    // The facility's rule, unless the clinic set one for this visit type or practitioner (migration 0096).
    const allowance = await this.waitlistRules.allowance(
      ctx.organizationId,
      input.facilityId,
      { visitTypeId: input.visitTypeId, practitionerId: input.practitionerId ?? null },
      rules,
    );
    if (!allowance.enabled) {
      throw new BusinessRuleError(
        allowance.source === "facility"
          ? "This clinic does not take waiting-list requests online — please call the clinic"
          : "This clinic does not take waiting-list requests for this kind of visit or doctor online — please call the clinic",
        allowance.source === "facility" ? "waitlist_not_available" : "waitlist_not_offered",
      );
    }
    const [type] = await this.db
      .select()
      .from(visitType)
      .where(and(eq(visitType.organizationId, ctx.organizationId), eq(visitType.id, input.visitTypeId)));
    if (!type || type.status !== "active" || !type.onlineBooking) {
      throw new BusinessRuleError("This kind of visit cannot be booked online — please call the clinic", "not_bookable_online");
    }
    const today = localDate(now, site.timezone);
    const problem = waitlistRangeProblem(input.earliestDate, input.latestDate, today, { ...rules, maxAdvanceDays: allowance.maxDaysAhead });
    if (problem) throw new BusinessRuleError(RANGE_MESSAGES[problem], `waitlist_${problem}`);
    if (input.practitionerId) {
      const [p] = await this.db
        .select({ id: practitioner.id })
        .from(practitioner)
        .where(and(eq(practitioner.organizationId, ctx.organizationId), eq(practitioner.id, input.practitionerId), eq(practitioner.status, "active")));
      if (!p) throw new NotFoundError("Practitioner");
    }
    // A waiting list is for full days: if a time is open in these days, the patient books it.
    if (await this.hasOpenTime(ctx, input, site.timezone, type.defaultDurationMinutes, rules, now)) {
      throw new ConflictError("There are open times on those days — choose one to book it", undefined, "open_times_available");
    }
    const created = await this.db.transaction(async (tx) => {
      // One request at a time per patient, so the limits hold under concurrent requests.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`patient-waitlist:${ctx.patientId}`}, 0))`);
      const mine = await tx
        .select({
          id: waitlistEntry.id,
          earliestDate: waitlistEntry.earliestDate,
          latestDate: waitlistEntry.latestDate,
          practitionerId: waitlistEntry.practitionerId,
          visitTypeId: waitlistEntry.visitTypeId,
        })
        .from(waitlistEntry)
        .where(
          and(
            eq(waitlistEntry.organizationId, ctx.organizationId),
            filedAsPatient(waitlistEntry.patientId, ctx.patientId),
            eq(waitlistEntry.facilityId, input.facilityId),
            eq(waitlistEntry.status, "waiting"),
            gte(waitlistEntry.latestDate, today),
          ),
        );
      // The rule's own limit counts requests under that rule; the facility's counts all of them.
      const source = allowance.source;
      const counted = source === "facility" ? mine : mine.filter((e) => this.underSameRule(e, source, input));
      if (counted.length >= allowance.maxEntries) {
        throw new ConflictError(
          `You are already on this clinic's waiting list ${allowance.maxEntries} times — remove one first`,
          undefined,
          "too_many_waitlist_entries",
        );
      }
      const overlaps = mine.some(
        (e) =>
          e.visitTypeId === input.visitTypeId &&
          (e.practitionerId ?? null) === (input.practitionerId ?? null) &&
          e.earliestDate <= input.latestDate &&
          e.latestDate >= input.earliestDate,
      );
      if (overlaps) throw new ConflictError("You are already waiting for those days", undefined, "already_on_waitlist");
      const [row] = await tx
        .insert(waitlistEntry)
        .values({
          organizationId: ctx.organizationId,
          facilityId: input.facilityId,
          patientId: ctx.patientId,
          practitionerId: input.practitionerId ?? null,
          visitTypeId: input.visitTypeId,
          earliestDate: input.earliestDate,
          latestDate: input.latestDate,
          priority: "routine",
          createdBy: null,
          createdByPatient: true,
        })
        .returning();
      const entry = found(row, "Waiting list entry");
      await this.audit.record(tx, ctx.audit, {
        action: "waitlist.add",
        resourceType: "appointment_waitlist_entry",
        resourceId: entry.id,
        patientId: ctx.patientId,
        metadata: { via: "patient_portal", facilityId: input.facilityId, earliestDate: input.earliestDate, latestDate: input.latestDate },
      });
      return entry;
    });
    return {
      id: created.id,
      facilityId: created.facilityId,
      facilityName: site.name,
      visitTypeId: created.visitTypeId,
      visitTypeName: type.name,
      practitionerId: created.practitionerId,
      practitionerName: null,
      earliestDate: created.earliestDate,
      latestDate: created.latestDate,
      createdAt: created.createdAt,
    };
  }

  /** Whether the patient may join for this visit type and practitioner at the facility, and how many requests (migration 0096). */
  async allowance(ctx: PatientBookingContext, query: { facilityId: string; visitTypeId: string; practitionerId?: string }) {
    const rules = await this.rules.forFacility(ctx.organizationId, query.facilityId);
    const a = await this.waitlistRules.allowance(
      ctx.organizationId,
      query.facilityId,
      { visitTypeId: query.visitTypeId, practitionerId: query.practitionerId ?? null },
      rules,
    );
    return { enabled: a.enabled, maxEntries: a.maxEntries, maxDaysAhead: a.maxDaysAhead };
  }

  /** The patient takes themselves off the list. */
  async leave(ctx: PatientBookingContext, entryId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [closed] = await tx
        .update(waitlistEntry)
        .set({ status: "cancelled", closedAt: new Date(), closedBy: null, closeReason: "Removed by the patient in MyHealth" })
        .where(
          and(
            eq(waitlistEntry.organizationId, ctx.organizationId),
            eq(waitlistEntry.id, entryId),
            filedAsPatient(waitlistEntry.patientId, ctx.patientId),
            eq(waitlistEntry.status, "waiting"),
            eq(waitlistEntry.createdByPatient, true),
          ),
        )
        .returning();
      if (!closed) throw new NotFoundError("Waiting list entry");
      await this.audit.record(tx, ctx.audit, {
        action: "waitlist.close",
        resourceType: "appointment_waitlist_entry",
        resourceId: entryId,
        patientId: ctx.patientId,
        reason: closed.closeReason ?? undefined,
        metadata: { via: "patient_portal" },
      });
    });
  }

  private underSameRule(
    entry: { practitionerId: string | null; visitTypeId: string | null },
    source: "practitioner" | "visit_type",
    input: { practitionerId?: string; visitTypeId: string },
  ): boolean {
    return source === "practitioner" ? entry.practitionerId === (input.practitionerId ?? null) : entry.visitTypeId === input.visitTypeId;
  }

  /** Whether any bookable time is open on the days (for the practitioner asked, or anyone on duty). */
  private async hasOpenTime(
    ctx: PatientBookingContext,
    input: z.infer<typeof patientWaitlistJoinSchema>,
    timeZone: string,
    durationMinutes: number,
    rules: BookingRules,
    now: Date,
  ): Promise<boolean> {
    const earliest = new Date(now.getTime() + rules.minLeadMinutes * 60_000);
    const latest = now.getTime() + rules.maxAdvanceDays * 86_400_000;
    for (let t = new Date(`${input.earliestDate}T12:00:00Z`).getTime(); t <= new Date(`${input.latestDate}T12:00:00Z`).getTime(); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      const conditions = [
        eq(practitionerSchedule.organizationId, ctx.organizationId),
        eq(practitionerSchedule.facilityId, input.facilityId),
        eq(practitionerSchedule.status, "active"),
        eq(practitionerSchedule.dayOfWeek, dayOfWeek(date)),
        lte(practitionerSchedule.validFrom, date),
        or(isNull(practitionerSchedule.validUntil), gte(practitionerSchedule.validUntil, date)),
        eq(practitioner.status, "active"),
      ];
      if (input.practitionerId) conditions.push(eq(practitioner.id, input.practitionerId));
      const onDuty = await this.db
        .selectDistinct({ id: practitioner.id })
        .from(practitionerSchedule)
        .innerJoin(practitioner, eq(practitioner.id, practitionerSchedule.practitionerId))
        .where(and(...conditions));
      const { start, end } = localDayBounds(date, timeZone);
      for (const p of onDuty) {
        const blocks = await this.appointments.scheduleBlocks(this.db, p.id, input.facilityId, date);
        const unavailable = [
          ...(await this.appointments.exceptions(this.db, input.facilityId, p.id, start, end)),
          ...(await this.appointments.bookedIntervals(this.db, p.id, start, end)),
        ];
        const slots = availableSlots({ date, timeZone, blocks, durationMinutes, unavailable, now: earliest }).filter((s) => s.startsAt.getTime() <= latest);
        if (slots.length > 0) return true;
      }
    }
    return false;
  }
}
