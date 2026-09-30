import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DomainEventHandlers, type DomainEventRecord, localDate, PH_TIMEZONE, systemActor } from "@healthcare/core";
import { DentalPatientAccess } from "@healthcare/dental";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PatientPush } from "./patient-push";
import { PortalAccountService } from "@healthcare/patient";

type Kind = "image-shared" | "plan-to-review" | "plan-to-decide";

/**
 * Tells patients who use MyHealth that their dentist shared an X-ray or photo, or prepared a treatment plan that awaits
 * their decision — an in-app copy plus SMS (or email when SMS is not possible), with no clinical detail (CLAUDE.md
 * §16): no tooth, procedure, image type or finding, only a pointer to MyHealth. Sent only while the organization shows
 * dental records there and what it announces is still true when the event is handled (a release withdrawn or a plan
 * decided in the meantime sends nothing). Consent and communication preferences apply (NotificationService).
 */
@Injectable()
export class PatientDentalNotices implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly dental: DentalPatientAccess,
    private readonly portal: PortalAccountService,
    private readonly organizations: OrganizationService,
    private readonly notifications: NotificationService,
    private readonly push: PatientPush,
  ) {}

  onModuleInit(): void {
    this.handlers.on("DentalImageReleased", "portal.dental-image-shared", (event) => this.imageShared(event));
    this.handlers.on(["DentalTreatmentPlanCreated", "DentalTreatmentPlanItemAdded"], "portal.dental-plan-awaiting", (event) => this.planAwaiting(event));
  }

  private async imageShared(event: DomainEventRecord): Promise<void> {
    const releaseId = event.payload["releaseId"];
    if (typeof releaseId !== "string" || !event.patientId) return;
    if (!(await this.dental.releaseStillShared(event.organizationId, event.patientId, releaseId))) return;
    await this.send(event, event.patientId, "image-shared", `dental-image:${releaseId}`);
  }

  private async planAwaiting(event: DomainEventRecord): Promise<void> {
    if (!event.patientId) return;
    const awaiting = await this.dental.planAwaitingPatient(event.organizationId, event.patientId, event.aggregateId);
    if (!awaiting) return;
    // One message per plan per day: a plan and the items added to it in the same visit are announced once.
    await this.send(
      event,
      event.patientId,
      awaiting.canDecide ? "plan-to-decide" : "plan-to-review",
      `dental-plan:${event.aggregateId}:${localDate(new Date(), PH_TIMEZONE)}`,
    );
  }

  private async send(event: DomainEventRecord, patientId: string, kind: Kind, key: string): Promise<void> {
    if (!(await this.portal.canUsePortal(event.organizationId, patientId))) return;
    const organization = await this.organizations.getOrganization(event.organizationId);
    const actor = systemActor(event.organizationId, event.facilityId, "portal-dental-notice");
    const variables = { kind, organizationName: organization.name.slice(0, 80) };
    const message = (channel: "in_app" | "sms" | "email") =>
      this.notifications.send(actor, {
        recipient: { type: "patient", patientId },
        channel,
        templateKey: "dental.record-update",
        variables,
        idempotencyKey: `${key}:${channel}`,
      });
    await message("in_app");
    // A device that allowed push gets the nudge there; otherwise SMS, or email when SMS is not possible.
    if (await this.push.send(actor, patientId, { templateKey: "dental.record-update", variables, idempotencyKey: `${key}:push` })) return;
    const sms = await message("sms");
    if (sms.status === "suppressed") await message("email");
  }
}
