import { Injectable } from "@nestjs/common";
import { AuthService } from "@healthcare/auth";
import type { NotificationCategory, NotificationChannel, Recipient, RecipientDirectory, RecipientResolution } from "@healthcare/notification";
import { PushSubscriptionService } from "@healthcare/notification";
import { PatientRecordService, PortalAccountService } from "@healthcare/patient";

/**
 * Adapter connecting the notification platform service to the patient and
 * user domains, so neither library depends on the other (dependency inversion
 * at the composition root).
 */
@Injectable()
export class AppRecipientDirectory implements RecipientDirectory {
  constructor(
    private readonly patients: PatientRecordService,
    private readonly auth: AuthService,
    private readonly portal: PortalAccountService,
    private readonly push: PushSubscriptionService,
  ) {}

  async resolve(organizationId: string, recipient: Recipient, channel: NotificationChannel, category: NotificationCategory): Promise<RecipientResolution> {
    if (recipient.type === "patient") {
      if (category === "security") {
        // Only the platform's own internal templates reach a patient this way (NotificationService): the account's
        // sign-in email, and only while the account can sign in. No communication preference applies.
        if (channel !== "email") return { allowed: false, reason: "invalid_channel" };
        const email = await this.portal.securityEmail(organizationId, recipient.patientId);
        return email ? { allowed: true, destination: email } : { allowed: false, reason: "no_portal_account" };
      }
      const portalActive = channel === "in_app" && (await this.portal.canUsePortal(organizationId, recipient.patientId));
      // Push goes to the devices of the patient's MyHealth account, only while they can sign in and have allowed at least one.
      let pushAccountId: string | undefined;
      if (channel === "push") {
        const accountId = await this.portal.activeAccountId(organizationId, recipient.patientId);
        if (accountId && (await this.push.hasDevice(accountId))) pushAccountId = accountId;
      }
      return this.patients.resolveContact(organizationId, recipient.patientId, channel, category, portalActive, pushAccountId);
    }
    if (!(await this.auth.hasActiveMembership(recipient.userId, organizationId))) return { allowed: false, reason: "user_not_member" };
    if (channel === "in_app") return { allowed: true, destination: null };
    if (channel === "email" || channel === "push") {
      const user = await this.auth.getUser(recipient.userId);
      if (user.status !== "active") return { allowed: false, reason: "user_disabled" };
      if (channel === "email") return { allowed: true, destination: user.email };
      // Push goes to the browsers the staff member allowed (migration 0101); the destination is the user id.
      return (await this.push.hasDevice(recipient.userId)) ? { allowed: true, destination: recipient.userId } : { allowed: false, reason: "no_push_device" };
    }
    return { allowed: false, reason: `staff_${channel}_not_supported` };
  }
}
