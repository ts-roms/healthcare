import { Injectable, type OnModuleInit } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { ClinicQueries } from "@healthcare/clinic";
import { DomainEventHandlers, type DomainEventRecord, localTime, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";

/** Who keeps the facility's schedule (the front desk): they rebook the freed time. */
const SCHEDULE_PERMISSION = "appointment.manage";

/**
 * Tells the clinic in the staff app when an appointment is cancelled — by the patient in MyHealth or by a staff member —
 * so the freed time can be offered again: the practitioner (their own staff account) and everyone who manages
 * appointments at the facility, except the person who cancelled. One notice per event and recipient. The notice names
 * the day, time, practitioner and who cancelled, never the patient (the appointment is opened behind access control).
 */
@Injectable()
export class AppointmentCancellationNotices implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly notifications: NotificationService,
    private readonly organizations: OrganizationService,
    private readonly clinic: ClinicQueries,
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("AppointmentCancelled", "appointment.cancelled-notice", (event) => this.handle(event));
  }

  async handle(event: DomainEventRecord): Promise<void> {
    if (!event.facilityId) return;
    const practitionerId = typeof event.payload["practitionerId"] === "string" ? event.payload["practitionerId"] : null;
    const cancelledBy = typeof event.payload["cancelledBy"] === "string" ? event.payload["cancelledBy"] : null;
    const byPatient = event.payload["changedByPatient"] === true;
    const startsAt = new Date(String(event.payload["startsAt"]));
    if (Number.isNaN(startsAt.getTime())) return;

    const [facility, practitionerUserId, practitionerNames, managers, cancellerNames] = await Promise.all([
      this.organizations.getFacility(event.organizationId, event.facilityId),
      practitionerId ? this.clinic.practitionerUserId(event.organizationId, practitionerId) : Promise.resolve(null),
      practitionerId ? this.clinic.practitionerNames(event.organizationId, [practitionerId]) : Promise.resolve(new Map<string, string>()),
      this.users.holdersOf(event.organizationId, SCHEDULE_PERMISSION, event.facilityId),
      cancelledBy ? this.users.displayNames(event.organizationId, [cancelledBy]) : Promise.resolve(new Map<string, string>()),
    ]);

    const recipients = new Set<string>(managers.map((m) => m.id));
    if (practitionerUserId) recipients.add(practitionerUserId);
    if (cancelledBy) recipients.delete(cancelledBy);
    if (recipients.size === 0) return;

    const variables = {
      day: new Intl.DateTimeFormat("en-CA", { timeZone: facility.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(startsAt),
      date: new Intl.DateTimeFormat("en-GB", { timeZone: facility.timezone, day: "numeric", month: "short", year: "numeric" }).format(startsAt),
      time: localTime(startsAt, facility.timezone),
      practitionerName: ((practitionerId && practitionerNames.get(practitionerId)) || "a practitioner").slice(0, 80),
      cancelledBy: (byPatient ? "the patient in MyHealth" : (cancelledBy && cancellerNames.get(cancelledBy)) || "the clinic").slice(0, 80),
    };
    const actor = systemActor(event.organizationId, event.facilityId, "appointment-cancelled-notice");
    for (const userId of recipients) {
      await this.notifications.send(actor, {
        recipient: { type: "user", userId },
        channel: "in_app",
        templateKey: "appointment.cancelled-notice",
        variables,
        idempotencyKey: `appointment-cancelled:${event.id}:${userId}`,
      });
    }
  }
}
