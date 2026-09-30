import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, ForbiddenError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, gt, inArray, isNotNull, lt } from "drizzle-orm";
import type { z } from "zod";
import { practitioner } from "../clinic.schema";
import { assertVersion, found, publicView } from "../clinic-support";
import type { calendarRangeSchema, cancelCalendarEventSchema, createCalendarEventSchema, updateCalendarEventSchema } from "./calendar.dto";
import { calendarEventEditableBy, calendarEventVisibleTo } from "./calendar.rules";
import { calendarEvent, calendarEventAttendee, type CalendarEventRecord } from "./calendar.schema";

export type CalendarEventView = Omit<CalendarEventRecord, "organizationId"> & {
  attendees: Array<{ userId: string; displayName: string }>;
  /** Whether the caller may change or cancel it (the API checks again). */
  editable: boolean;
};

/**
 * The staff calendar (docs/domains/calendar.md): meetings, events, blocked time, trainings and reminders of a facility.
 * Appointments are not copied here — screens show them beside these events from the appointment queries. Events never
 * carry patient data; the organizer (or someone with clinic.configure) changes or cancels one, and cancelled events
 * stay listed with their reason.
 */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  async list(actor: Actor, query: z.infer<typeof calendarRangeSchema>): Promise<CalendarEventView[]> {
    await this.organizations.getFacility(actor.organizationId, query.facilityId);
    const rows = await this.db
      .select()
      .from(calendarEvent)
      .where(
        and(
          eq(calendarEvent.organizationId, actor.organizationId),
          eq(calendarEvent.facilityId, query.facilityId),
          lt(calendarEvent.startsAt, new Date(query.to)),
          gt(calendarEvent.endsAt, new Date(query.from)),
        ),
      )
      .orderBy(asc(calendarEvent.startsAt), asc(calendarEvent.id));
    const attendees = await this.attendeesOf(
      this.db,
      actor.organizationId,
      rows.map((r) => r.id),
    );
    const visible = rows.filter((row) =>
      calendarEventVisibleTo(
        row,
        (attendees.get(row.id) ?? []).map((a) => a.userId),
        actor.userId,
      ),
    );
    return visible.map((row) => this.view(actor, row, attendees.get(row.id) ?? []));
  }

  async get(actor: Actor, eventId: string): Promise<CalendarEventView> {
    const row = found(await this.load(this.db, actor, eventId), "Calendar event");
    const attendees = (await this.attendeesOf(this.db, actor.organizationId, [row.id])).get(row.id) ?? [];
    if (
      !calendarEventVisibleTo(
        row,
        attendees.map((a) => a.userId),
        actor.userId,
      )
    )
      throw found(undefined, "Calendar event");
    return this.view(actor, row, attendees);
  }

  async create(actor: Actor, input: z.infer<typeof createCalendarEventSchema>): Promise<CalendarEventView> {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    const { attendeeUserIds, ...fields } = input;
    const created = await this.db.transaction(async (tx) => {
      const attendees = await this.checkAttendees(tx, actor, attendeeUserIds);
      const [row] = await tx
        .insert(calendarEvent)
        .values({
          ...fields,
          startsAt: new Date(fields.startsAt),
          endsAt: new Date(fields.endsAt),
          organizationId: actor.organizationId,
          organizerUserId: actor.userId,
          organizerName: actor.displayName,
          updatedBy: actor.userId,
        })
        .returning();
      const event = found(row, "Calendar event");
      await this.setAttendees(tx, actor, event.id, attendees);
      await this.audit.record(tx, actor, {
        action: "calendar.event.create",
        resourceType: "calendar_event",
        resourceId: event.id,
        metadata: { facilityId: event.facilityId, kind: event.kind, visibility: event.visibility, attendees: attendees.length },
      });
      return event;
    });
    return this.get(actor, created.id);
  }

  async update(actor: Actor, eventId: string, input: z.infer<typeof updateCalendarEventSchema>): Promise<CalendarEventView> {
    const { version, attendeeUserIds, ...fields } = input;
    await this.db.transaction(async (tx) => {
      const current = found(await this.load(tx, actor, eventId, true), "Calendar event");
      this.assertEditable(actor, current);
      assertVersion(current.version, version, "Calendar event");
      const attendees = await this.checkAttendees(tx, actor, attendeeUserIds);
      await tx
        .update(calendarEvent)
        .set({
          ...fields,
          startsAt: new Date(fields.startsAt),
          endsAt: new Date(fields.endsAt),
          updatedBy: actor.userId,
          updatedAt: new Date(),
          version: current.version + 1,
        })
        .where(and(eq(calendarEvent.organizationId, actor.organizationId), eq(calendarEvent.id, eventId)));
      await this.setAttendees(tx, actor, eventId, attendees);
      await this.audit.record(tx, actor, {
        action: "calendar.event.update",
        resourceType: "calendar_event",
        resourceId: eventId,
        metadata: { facilityId: current.facilityId, kind: fields.kind, visibility: fields.visibility, attendees: attendees.length },
      });
    });
    return this.get(actor, eventId);
  }

  async cancel(actor: Actor, eventId: string, input: z.infer<typeof cancelCalendarEventSchema>): Promise<CalendarEventView> {
    await this.db.transaction(async (tx) => {
      const current = found(await this.load(tx, actor, eventId, true), "Calendar event");
      this.assertEditable(actor, current);
      assertVersion(current.version, input.version, "Calendar event");
      await tx
        .update(calendarEvent)
        .set({
          status: "cancelled",
          cancelReason: input.reason,
          cancelledBy: actor.userId,
          cancelledAt: new Date(),
          updatedBy: actor.userId,
          updatedAt: new Date(),
          version: current.version + 1,
        })
        .where(and(eq(calendarEvent.organizationId, actor.organizationId), eq(calendarEvent.id, eventId)));
      await this.audit.record(tx, actor, {
        action: "calendar.event.cancel",
        resourceType: "calendar_event",
        resourceId: eventId,
        reason: input.reason,
        metadata: { facilityId: current.facilityId },
      });
    });
    return this.get(actor, eventId);
  }

  private assertEditable(actor: Actor, event: CalendarEventRecord): void {
    if (event.status === "cancelled") throw new BusinessRuleError("This event was cancelled", "calendar_event_cancelled");
    if (!calendarEventEditableBy(event, actor.userId, actor.permissions.has("clinic.configure"))) {
      throw new ForbiddenError("Only the organizer changes or cancels this event");
    }
  }

  private async load(db: DbExecutor, actor: Actor, eventId: string, lock = false): Promise<CalendarEventRecord | undefined> {
    const query = db
      .select()
      .from(calendarEvent)
      .where(and(eq(calendarEvent.organizationId, actor.organizationId), eq(calendarEvent.id, eventId)));
    const [row] = lock ? await query.for("update") : await query;
    return row;
  }

  /** Attendees are the organization's active clinicians (practitioners linked to a user). */
  private async checkAttendees(db: DbExecutor, actor: Actor, userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const rows = await db
      .select({ userId: practitioner.userId })
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, actor.organizationId), eq(practitioner.status, "active"), inArray(practitioner.userId, unique)));
    if (rows.length !== unique.length) throw new BusinessRuleError("Invite active clinicians of your organization", "calendar_attendee_invalid");
    return unique;
  }

  private async setAttendees(db: DbExecutor, actor: Actor, eventId: string, userIds: string[]): Promise<void> {
    await db.delete(calendarEventAttendee).where(eq(calendarEventAttendee.eventId, eventId));
    if (userIds.length > 0) {
      await db.insert(calendarEventAttendee).values(userIds.map((userId) => ({ eventId, organizationId: actor.organizationId, userId })));
    }
  }

  private async attendeesOf(db: DbExecutor, organizationId: string, eventIds: string[]): Promise<Map<string, Array<{ userId: string; displayName: string }>>> {
    const result = new Map<string, Array<{ userId: string; displayName: string }>>();
    if (eventIds.length === 0) return result;
    const rows = await db
      .select({ eventId: calendarEventAttendee.eventId, userId: calendarEventAttendee.userId, displayName: practitioner.displayName })
      .from(calendarEventAttendee)
      .innerJoin(
        practitioner,
        and(eq(practitioner.organizationId, calendarEventAttendee.organizationId), eq(practitioner.userId, calendarEventAttendee.userId)),
      )
      .where(and(eq(calendarEventAttendee.organizationId, organizationId), inArray(calendarEventAttendee.eventId, eventIds), isNotNull(practitioner.userId)))
      .orderBy(asc(practitioner.displayName));
    for (const row of rows) {
      const list = result.get(row.eventId) ?? [];
      list.push({ userId: row.userId, displayName: row.displayName });
      result.set(row.eventId, list);
    }
    return result;
  }

  private view(actor: Actor, row: CalendarEventRecord, attendees: Array<{ userId: string; displayName: string }>): CalendarEventView {
    return {
      ...publicView(row),
      attendees,
      editable: actor.permissions.has("calendar.manage") && calendarEventEditableBy(row, actor.userId, actor.permissions.has("clinic.configure")),
    };
  }
}
