import { Injectable, type OnModuleInit } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PatientPush } from "./patient-push";
import { PatientMessageService, PortalAccountService } from "@healthcare/patient";

const MANAGE_PERMISSION = "patient.message.manage";

/**
 * Notices of MyHealth conversations (docs/domains/patient-messaging.md), one per event and recipient:
 * - a patient's message tells the clinic in the app — the assigned person; else the person the topic is routed to; else the
 *   holders of the role it is routed to who can reply; else everyone who can reply at the patient's facility — once for a
 *   run of messages;
 * - the clinic's reply tells the patient by SMS, or email when SMS is not possible, that a message is waiting — never
 *   its content, the sender or the subject. Consent and communication preferences apply.
 */
@Injectable()
export class PatientMessageNotices implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly portal: PortalAccountService,
    private readonly organizations: OrganizationService,
    private readonly notifications: NotificationService,
    private readonly users: UsersService,
    private readonly messages: PatientMessageService,
    private readonly push: PatientPush,
  ) {}

  onModuleInit(): void {
    this.handlers.on("PatientMessageSent", "portal.message-notice", (event) => this.handle(event));
  }

  private async handle(event: DomainEventRecord): Promise<void> {
    const sender = event.payload["sender"];
    if (sender === "patient") return this.tellClinic(event);
    if (sender === "staff") return this.tellPatient(event);
  }

  private async tellClinic(event: DomainEventRecord): Promise<void> {
    if (event.payload["notify"] !== true) return;
    const threadId = event.aggregateId;
    const recipients = await this.recipientsOf(event.organizationId, threadId, event.facilityId ?? null);
    const actor = systemActor(event.organizationId, event.facilityId, "patient-message-notice");
    for (const person of recipients) {
      await this.notifications.send(actor, {
        recipient: { type: "user", userId: person.id },
        channel: "in_app",
        templateKey: "portal.message-new",
        variables: { threadId },
        idempotencyKey: `message-new:${event.id}:${person.id}`,
      });
    }
  }

  /** Who is told of a patient's message: the assignee, the routed person, the routed role's repliers, or every replier at the facility. */
  async recipientsOf(organizationId: string, threadId: string, facilityId: string | null): Promise<Array<{ id: string }>> {
    const routing = await this.messages.routingOf(organizationId, threadId);
    const scope = routing.facilityId ?? facilityId;
    if (routing.assignedTo) return [{ id: routing.assignedTo }];
    if (routing.routeUserId) return [{ id: routing.routeUserId }];
    const repliers = await this.users.holdersOf(organizationId, MANAGE_PERMISSION, scope);
    if (routing.routeRoleKey) {
      const holders = await this.users.holdersOfRole(organizationId, routing.routeRoleKey, scope);
      const named = repliers.filter((p) => holders.some((h) => h.id === p.id));
      if (named.length) return named.map((p) => ({ id: p.id }));
    }
    return repliers.map((p) => ({ id: p.id }));
  }

  private async tellPatient(event: DomainEventRecord): Promise<void> {
    const patientId = event.patientId;
    if (!patientId || !(await this.portal.canUsePortal(event.organizationId, patientId))) return;
    const organization = await this.organizations.getOrganization(event.organizationId);
    const actor = systemActor(event.organizationId, event.facilityId, "patient-message-notice");
    const message = (channel: "sms" | "email") =>
      this.notifications.send(actor, {
        recipient: { type: "patient", patientId },
        channel,
        templateKey: "portal.message-received",
        variables: { organizationName: organization.name.slice(0, 80) },
        idempotencyKey: `message-received:${event.id}:${channel}`,
      });
    if (
      await this.push.send(actor, patientId, {
        templateKey: "portal.message-received",
        variables: { organizationName: organization.name.slice(0, 80) },
        idempotencyKey: `message-received:${event.id}:push`,
      })
    )
      return;
    const sms = await message("sms");
    if (sms.status === "suppressed") await message("email");
  }
}
