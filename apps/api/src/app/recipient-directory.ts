import { Injectable } from "@nestjs/common";
import { AuthService } from "@healthcare/auth";
import type { NotificationCategory, NotificationChannel, Recipient, RecipientDirectory, RecipientResolution } from "@healthcare/notification";
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
  ) {}

  async resolve(organizationId: string, recipient: Recipient, channel: NotificationChannel, category: NotificationCategory): Promise<RecipientResolution> {
    if (recipient.type === "patient") {
      if (category === "security") return { allowed: false, reason: "invalid_category" };
      const portalActive = channel === "in_app" && (await this.portal.canUsePortal(organizationId, recipient.patientId));
      return this.patients.resolveContact(organizationId, recipient.patientId, channel, category, portalActive);
    }
    if (!(await this.auth.hasActiveMembership(recipient.userId, organizationId))) return { allowed: false, reason: "user_not_member" };
    if (channel === "in_app") return { allowed: true, destination: null };
    if (channel === "email") {
      const user = await this.auth.getUser(recipient.userId);
      return user.status === "active" ? { allowed: true, destination: user.email } : { allowed: false, reason: "user_disabled" };
    }
    return { allowed: false, reason: `staff_${channel}_not_supported` };
  }
}
