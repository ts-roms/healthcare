import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DomainEventHandlers, type DomainEventRecord, localTime, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";

const KINDS = { AppointmentBooked: "booked", AppointmentRescheduled: "rescheduled", AppointmentCancelled: "cancelled" } as const;

/**
 * Confirms by SMS (and in the MyHealth inbox) what a patient did in MyHealth (booked, moved or cancelled
 * an appointment), so an unexpected change is noticed. Only for the patient's
 * own changes; staff changes are confirmed by the clinic as before. Consent and
 * communication preferences are enforced by NotificationService.
 */
@Injectable()
export class PatientBookingNotices implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly notifications: NotificationService,
    private readonly organizations: OrganizationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on(Object.keys(KINDS), "patient-booking.confirm", (event) => this.confirm(event));
  }

  private async confirm(event: DomainEventRecord): Promise<void> {
    const kind = KINDS[event.eventType as keyof typeof KINDS];
    const byPatient = event.eventType === "AppointmentBooked" ? event.payload["bookedByPatient"] : event.payload["changedByPatient"];
    if (!kind || byPatient !== true || !event.patientId || !event.facilityId) return;
    const startsAt = new Date(String(event.payload["startsAt"]));
    const facility = await this.organizations.getFacility(event.organizationId, event.facilityId);
    const variables = {
      kind,
      facilityName: facility.name.slice(0, 80),
      date: new Intl.DateTimeFormat("en-PH", { timeZone: facility.timezone, dateStyle: "medium" }).format(startsAt),
      time: localTime(startsAt, facility.timezone),
    };
    for (const channel of ["sms", "in_app"] as const) {
      await this.notifications.send(systemActor(event.organizationId, event.facilityId, "patient-booking"), {
        recipient: { type: "patient", patientId: event.patientId },
        channel,
        templateKey: "appointment.self-service",
        variables,
        idempotencyKey: channel === "sms" ? `patient-booking:${event.id}` : `patient-booking:${event.id}:in_app`,
      });
    }
  }
}
