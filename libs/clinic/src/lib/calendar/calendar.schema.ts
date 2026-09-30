import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0086_calendar.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const CALENDAR_EVENT_KINDS = ["meeting", "event", "blocked", "training", "reminder"] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];
export const CALENDAR_VISIBILITIES = ["facility", "invitees"] as const;
export type CalendarVisibility = (typeof CALENDAR_VISIBILITIES)[number];

export const calendarEvent = pgTable("calendar_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").$type<CalendarEventKind>().notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  allDay: boolean("all_day").notNull().default(false),
  location: text("location"),
  description: text("description"),
  visibility: text("visibility").$type<CalendarVisibility>().notNull().default("facility"),
  status: text("status").$type<"scheduled" | "cancelled">().notNull().default("scheduled"),
  organizerUserId: uuid("organizer_user_id").notNull(),
  organizerName: text("organizer_name").notNull(),
  cancelReason: text("cancel_reason"),
  cancelledBy: uuid("cancelled_by"),
  cancelledAt: ts("cancelled_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type CalendarEventRecord = typeof calendarEvent.$inferSelect;

export const calendarEventAttendee = pgTable(
  "calendar_event_attendee",
  {
    eventId: uuid("event_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);
