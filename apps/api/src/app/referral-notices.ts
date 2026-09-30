import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ClinicQueries } from "@healthcare/clinic";
import { DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";

/**
 * Referral notices (docs/domains/clinic.md, "Referrals"): the practitioner a patient is referred to hears of it in the
 * app; the referring practitioner hears when an internal referral is accepted, declined or completed. The referral
 * number only — who and why are read in the referral, behind access control. One message per event and recipient.
 */
@Injectable()
export class ReferralNotices implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly clinic: ClinicQueries,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("ReferralCreated", "clinic.referral-new", (event) =>
      event.payload["kind"] === "internal" ? this.tell(event, event.payload["toPractitionerId"], "new") : Promise.resolve(),
    );
    this.handlers.on(["ReferralAccepted", "ReferralDeclined", "ReferralCompleted"], "clinic.referral-answered", (event) =>
      event.payload["kind"] === "internal"
        ? this.tell(
            event,
            event.payload["referringPractitionerId"],
            event.eventType === "ReferralAccepted" ? "accepted" : event.eventType === "ReferralDeclined" ? "declined" : "completed",
          )
        : Promise.resolve(),
    );
  }

  private async tell(event: DomainEventRecord, practitionerId: unknown, kind: "new" | "accepted" | "declined" | "completed"): Promise<void> {
    const referralNumber = event.payload["referralNumber"];
    if (typeof practitionerId !== "string" || typeof referralNumber !== "string") return;
    const userId = await this.clinic.practitionerUserId(event.organizationId, practitionerId);
    // A practitioner without a staff account is told another way (the letter, the phone).
    if (!userId) return;
    await this.notifications.send(systemActor(event.organizationId, event.facilityId, "referral-notice"), {
      recipient: { type: "user", userId },
      channel: "in_app",
      templateKey: "clinic.referral-notice",
      variables: { referralId: event.aggregateId, referralNumber, kind },
      idempotencyKey: `referral:${event.id}:${userId}`,
    });
  }
}
