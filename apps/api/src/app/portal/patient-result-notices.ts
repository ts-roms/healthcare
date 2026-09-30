import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DomainEventHandlers, type DomainEventRecord, localDate, PH_TIMEZONE, systemActor } from "@healthcare/core";
import { LabPatientAccess } from "@healthcare/laboratory";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PatientPush } from "./patient-push";
import { PortalAccountService } from "@healthcare/patient";

/**
 * Tells patients who use MyHealth that results are waiting for them, by SMS
 * (or email when SMS is not possible). The message names no test and no value
 * (CLAUDE.md §16): it only points to the portal, where access is controlled.
 * Sent only when a result of the order is actually visible to the patient —
 * released, releasable to patients and, if critical, acknowledged by the care
 * team — so a critical value never reaches the patient first.
 */
@Injectable()
export class PatientResultNotices implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly lab: LabPatientAccess,
    private readonly portal: PortalAccountService,
    private readonly organizations: OrganizationService,
    private readonly notifications: NotificationService,
    private readonly push: PatientPush,
  ) {}

  onModuleInit(): void {
    this.handlers.on(["LaboratoryResultReleased", "CriticalResultAcknowledged"], "portal.results-ready", (event) => this.notify(event, "ready"));
    this.handlers.on("LaboratoryResultAmended", "portal.results-updated", (event) => this.notify(event, "updated"));
  }

  private async notify(event: DomainEventRecord, kind: "ready" | "updated"): Promise<void> {
    const orderId = event.payload["orderId"];
    if (typeof orderId !== "string" || !event.patientId) return;
    if (kind === "ready" && event.eventType === "LaboratoryResultReleased" && event.payload["critical"] === true) return; // waits for acknowledgement
    if (!(await this.portal.canUsePortal(event.organizationId, event.patientId))) return;
    if (!(await this.lab.orderHasVisibleResults(event.organizationId, orderId))) return;
    const organization = await this.organizations.getOrganization(event.organizationId);
    const actor = systemActor(event.organizationId, event.facilityId, "portal-results-notice");
    // One message per order per day (several results are usually released together); corrections get their own.
    const key = kind === "ready" ? `lab-ready:${orderId}:${localDate(new Date(), PH_TIMEZONE)}` : `lab-updated:${event.aggregateId}`;
    const variables = { kind, organizationName: organization.name.slice(0, 80) };
    // A copy in the MyHealth inbox, and a nudge by SMS (or email) to go and look.
    await this.notifications.send(actor, {
      recipient: { type: "patient", patientId: event.patientId },
      channel: "in_app",
      templateKey: "lab.results-available",
      variables,
      idempotencyKey: `${key}:in_app`,
    });
    if (await this.push.send(actor, event.patientId, { templateKey: "lab.results-available", variables, idempotencyKey: `${key}:push` })) return;
    const sms = await this.notifications.send(actor, {
      recipient: { type: "patient", patientId: event.patientId },
      channel: "sms",
      templateKey: "lab.results-available",
      variables,
      idempotencyKey: `${key}:sms`,
    });
    if (sms.status !== "suppressed") return;
    await this.notifications.send(actor, {
      recipient: { type: "patient", patientId: event.patientId },
      channel: "email",
      templateKey: "lab.results-available",
      variables,
      idempotencyKey: `${key}:email`,
    });
  }
}
