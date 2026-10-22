import { Injectable, type OnModuleInit } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PatientPush } from "./patient-push";
import { PortalAccountService, PortalProxyService } from "@healthcare/patient";

/** Who hears about new records requests: staff of the records office (any facility of the organization). */
const RECORDS_OFFICE_PERMISSION = "patient.records-request.manage";

/**
 * Records notices (docs/domains/records-requests.md): patients who use MyHealth are told — in the app and by SMS (or
 * email when SMS is not possible), with no clinical detail — when a medical certificate or a referral letter from their
 * visit is ready or the records office answered their request; the records office is told in the app of each new request. Consent and
 * communication preferences apply (NotificationService); one message per event and recipient.
 */
@Injectable()
export class PatientRecordsNotices implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly portal: PortalAccountService,
    private readonly organizations: OrganizationService,
    private readonly notifications: NotificationService,
    private readonly users: UsersService,
    private readonly push: PatientPush,
    private readonly proxies: PortalProxyService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("MedicalCertificateIssued", "portal.certificate-ready", (event) => this.tellPatient(event, { kind: "certificate-ready" }));
    this.handlers.on("ReferralCreated", "portal.referral-ready", (event) => this.tellPatient(event, { kind: "referral-ready" }));
    this.handlers.on(["RecordsRequestFulfilled", "RecordsRequestDeclined"], "portal.records-request-answered", (event) =>
      this.tellPatient(event, { kind: "request-answered", requestNumber: event.payload["requestNumber"] }),
    );
    // The patient and, when they have no account or are a minor, the guardians who may sign for them.
    this.handlers.on("ConsentSignatureRequested", "portal.form-ready", async (event) => {
      await this.tellPatient(event, { kind: "form-ready" });
      if (!event.patientId) return;
      for (const guardianId of await this.proxies.liveGuardians(event.organizationId, event.patientId)) {
        await this.tellPatient(event, { kind: "form-ready" }, guardianId);
      }
    });
    this.handlers.on("RecordsRequestSubmitted", "records.request-new", (event) => this.tellRecordsOffice(event));
  }

  private async tellPatient(event: DomainEventRecord, variables: Record<string, unknown>, recipientPatientId?: string): Promise<void> {
    const patientId = recipientPatientId ?? event.patientId;
    if (!patientId || !(await this.portal.canUsePortal(event.organizationId, patientId))) return;
    const organization = await this.organizations.getOrganization(event.organizationId);
    const actor = systemActor(event.organizationId, event.facilityId, "portal-records-notice");
    const message = (channel: "in_app" | "sms" | "email") =>
      this.notifications.send(actor, {
        recipient: { type: "patient", patientId },
        channel,
        templateKey: "records.update",
        variables: { ...variables, organizationName: organization.name.slice(0, 80) },
        idempotencyKey: `records:${event.id}:${patientId}:${channel}`,
      });
    await message("in_app");
    if (
      await this.push.send(actor, patientId, {
        templateKey: "records.update",
        variables: { ...variables, organizationName: organization.name.slice(0, 80) },
        idempotencyKey: `records:${event.id}:${patientId}:push`,
      })
    )
      return;
    const sms = await message("sms");
    if (sms.status === "suppressed") await message("email");
  }

  private async tellRecordsOffice(event: DomainEventRecord): Promise<void> {
    const requestNumber = event.payload["requestNumber"];
    if (typeof requestNumber !== "string") return;
    const staff = await this.users.holdersOf(event.organizationId, RECORDS_OFFICE_PERMISSION, null);
    const actor = systemActor(event.organizationId, null, "records-request-notice");
    for (const person of staff) {
      await this.notifications.send(actor, {
        recipient: { type: "user", userId: person.id },
        channel: "in_app",
        templateKey: "records.request-new",
        variables: { requestId: event.aggregateId, requestNumber },
        idempotencyKey: `records-request-new:${event.id}:${person.id}`,
      });
    }
  }
}
