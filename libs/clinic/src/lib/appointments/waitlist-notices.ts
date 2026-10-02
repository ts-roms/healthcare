import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { DATABASE, type Database, DomainEventHandlers, type DomainEventRecord, localDate, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, gte, lte } from "drizzle-orm";
import { visitType, waitlistEntry } from "../clinic.schema";
import { BookingRulesService } from "../config/booking-rules.service";
import { patientMayChange, waitlistMatches } from "../domain/patient-booking";
import { WaitlistOffersService } from "./waitlist-offers.service";

/**
 * When a time opens (an appointment is cancelled, or moved away), patients on the facility's waiting list for those days
 * (their entries made in MyHealth) are told by SMS, or email when SMS is not possible, that a time may have opened and
 * that they should sign in to book it — first come, first served. Nothing is booked for them. One notice per entry per
 * day of the opened time. No practitioner, time or clinical detail leaves the platform: the message only names the clinic
 * and the day.
 */
@Injectable()
export class WaitlistNotices implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly handlers: DomainEventHandlers,
    private readonly notifications: NotificationService,
    private readonly organizations: OrganizationService,
    private readonly rules: BookingRulesService,
    private readonly offers: WaitlistOffersService,
  ) {}

  onModuleInit(): void {
    this.handlers.on(["AppointmentCancelled", "AppointmentRescheduled"], "waitlist.slot-opened", (event) => this.slotOpened(event));
  }

  private async slotOpened(event: DomainEventRecord): Promise<void> {
    if (!event.facilityId) return;
    // A cancelled visit frees its own time; a moved one frees the time it left (with the practitioner it had).
    const moved = event.eventType === "AppointmentRescheduled";
    const freedAt = new Date(String(moved ? event.payload["previousStartsAt"] : event.payload["startsAt"]));
    const practitionerId = String(moved ? (event.payload["previousPractitionerId"] ?? event.payload["practitionerId"]) : event.payload["practitionerId"]);
    if (Number.isNaN(freedAt.getTime())) return;
    const site = await this.organizations.getFacility(event.organizationId, event.facilityId);
    const rules = await this.rules.forFacility(event.organizationId, event.facilityId);
    if (!rules.waitlistEnabled) return;
    const now = new Date();
    // A time too close to start can no longer be booked online.
    if (!patientMayChange(freedAt, now, { ...rules, changeCutoffMinutes: rules.minLeadMinutes })) return;
    const date = localDate(freedAt, site.timezone);
    const visitTypeId = typeof event.payload["visitTypeId"] === "string" ? event.payload["visitTypeId"] : null;
    if (rules.waitlistMode === "offer") {
      // The exact time is held for the next entries; its length is the visit type's.
      const [type] = visitTypeId
        ? await this.db.select({ minutes: visitType.defaultDurationMinutes }).from(visitType).where(eq(visitType.id, visitTypeId))
        : [];
      const endsAt = new Date(freedAt.getTime() + (type?.minutes ?? 30) * 60_000);
      await this.offers.offerSlot(
        event.organizationId,
        event.facilityId,
        { startsAt: freedAt, endsAt, practitionerId, visitTypeId, freedByPatientId: event.patientId ?? null },
        now,
      );
      return;
    }
    const entries = await this.db
      .select()
      .from(waitlistEntry)
      .where(
        and(
          eq(waitlistEntry.organizationId, event.organizationId),
          eq(waitlistEntry.facilityId, event.facilityId),
          eq(waitlistEntry.status, "waiting"),
          eq(waitlistEntry.createdByPatient, true),
          lte(waitlistEntry.earliestDate, date),
          gte(waitlistEntry.latestDate, date),
        ),
      );
    const actor = systemActor(event.organizationId, event.facilityId, "waitlist-notice");
    for (const entry of entries) {
      if (entry.patientId === event.patientId) continue;
      if (!waitlistMatches(entry, { date, practitionerId, visitTypeId })) continue;
      const send = (channel: "sms" | "email") =>
        this.notifications.send(actor, {
          recipient: { type: "patient", patientId: entry.patientId },
          channel,
          templateKey: "appointment.waitlist-opened",
          variables: {
            facilityName: site.name.slice(0, 80),
            date: new Intl.DateTimeFormat("en-PH", { timeZone: site.timezone, dateStyle: "medium" }).format(freedAt),
          },
          // Once a day per entry, however many times must have opened.
          idempotencyKey: `waitlist-opened:${entry.id}:${date}:${channel}`,
        });
      const sms = await send("sms");
      if (sms.status === "suppressed") await send("email");
    }
  }
}
