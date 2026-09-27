import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { DATABASE, type Database, DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, gt, inArray } from "drizzle-orm";
import { appointment } from "../clinic.schema";

/**
 * After a missed visit, invites the patient to book again (SMS and the
 * MyHealth inbox) — unless they already have another visit coming up. The
 * message names the facility and date only, never the reason for the visit.
 * Consent and communication preferences are enforced by NotificationService;
 * one message per missed appointment (idempotent).
 */
@Injectable()
export class NoShowFollowUp implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly handlers: DomainEventHandlers,
    private readonly notifications: NotificationService,
    private readonly organizations: OrganizationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("AppointmentNoShow", "no-show.follow-up", (event) => this.followUp(event));
  }

  private async followUp(event: DomainEventRecord): Promise<void> {
    if (!event.patientId || !event.facilityId) return;
    const [upcoming] = await this.db
      .select({ id: appointment.id })
      .from(appointment)
      .where(
        and(
          eq(appointment.organizationId, event.organizationId),
          eq(appointment.patientId, event.patientId),
          inArray(appointment.status, ["booked", "confirmed"]),
          gt(appointment.startsAt, new Date()),
        ),
      )
      .limit(1);
    if (upcoming) return;
    const facility = await this.organizations.getFacility(event.organizationId, event.facilityId);
    const startsAt = new Date(String(event.payload["startsAt"]));
    const variables = {
      facilityName: facility.name.slice(0, 80),
      date: new Intl.DateTimeFormat("en-PH", { timeZone: facility.timezone, dateStyle: "medium" }).format(startsAt),
    };
    for (const channel of ["sms", "in_app"] as const) {
      await this.notifications.send(systemActor(event.organizationId, event.facilityId, "no-show-follow-up"), {
        recipient: { type: "patient", patientId: event.patientId },
        channel,
        templateKey: "appointment.no-show",
        variables,
        idempotencyKey: `no-show:${event.aggregateId}:${channel}`,
      });
    }
  }
}
