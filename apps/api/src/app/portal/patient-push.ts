import { Injectable } from "@nestjs/common";
import type { Actor } from "@healthcare/core";
import { NotificationService, PushSubscriptionService, type SendNotificationInput } from "@healthcare/notification";
import { PortalAccountService } from "@healthcare/patient";

/**
 * "Push first": for a patient who has allowed notifications on a device, a content-free notice goes there instead of
 * being sent by SMS or email (which may cost money and travels further). A patient with no device, or whose account cannot
 * sign in, gets no push attempt at all — no suppressed rows clutter their communication history — and the caller carries on
 * with SMS or email as before.
 */
@Injectable()
export class PatientPush {
  constructor(
    private readonly notifications: NotificationService,
    private readonly devices: PushSubscriptionService,
    private readonly portal: PortalAccountService,
  ) {}

  /** Tries push; true when the message was accepted for delivery (so the caller need not send by SMS or email). */
  async send(actor: Actor, patientId: string, message: Pick<SendNotificationInput, "templateKey" | "variables" | "idempotencyKey">): Promise<boolean> {
    const accountId = await this.portal.activeAccountId(actor.organizationId, patientId);
    if (!accountId || !(await this.devices.hasDevice(accountId))) return false;
    const sent = await this.notifications.send(actor, { recipient: { type: "patient", patientId }, channel: "push", ...message });
    return sent.status !== "suppressed";
  }
}
