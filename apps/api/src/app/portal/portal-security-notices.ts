import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG, type AppConfig, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PortalSecurityMailers, type PortalSecurityMailer } from "@healthcare/patient";

/**
 * Security messages of a MyHealth account (docs/architecture/portal-app.md, "Password reset"): the reset link and the
 * notice that the password changed, by email to the account's sign-in email (`AppRecipientDirectory` resolves it; no
 * communication preference applies). The link points at the portal's public address (`PORTAL_BASE_URL`) with the token
 * in the fragment, which browsers do not send to servers or in Referer headers. Without that address nothing is sent.
 */
@Injectable()
export class PortalSecurityNotices implements PortalSecurityMailer, OnModuleInit {
  private readonly logger = new Logger(PortalSecurityNotices.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailers: PortalSecurityMailers,
    private readonly organizations: OrganizationService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.mailers.register(this);
  }

  async sendPasswordResetLink(input: { organizationId: string; patientId: string; resetId: string; token: string; validMinutes: number }): Promise<void> {
    const base = this.config.PORTAL_BASE_URL;
    if (!base) {
      this.logger.warn("PORTAL_BASE_URL is not set: the password reset link was not sent");
      return;
    }
    const link = `${base}/reset-password#token=${input.token}`;
    // The link is a credential: in development, with no mail provider, it is here so the flow can be tried.
    if (this.config.NODE_ENV === "development") this.logger.warn(`Password reset link (development only): ${link}`);
    const organization = await this.organizations.getOrganization(input.organizationId);
    await this.notifications.send(systemActor(input.organizationId, null, "portal-password-reset"), {
      recipient: { type: "patient", patientId: input.patientId },
      channel: "email",
      templateKey: "portal.password-reset",
      variables: { organizationName: organization.name.slice(0, 80), link, validMinutes: input.validMinutes },
      idempotencyKey: `portal-reset:${input.resetId}`,
    });
  }

  async sendPasswordChanged(input: { organizationId: string; patientId: string; resetId: string }): Promise<void> {
    const organization = await this.organizations.getOrganization(input.organizationId);
    await this.notifications.send(systemActor(input.organizationId, null, "portal-password-reset"), {
      recipient: { type: "patient", patientId: input.patientId },
      channel: "email",
      templateKey: "portal.password-changed",
      variables: { organizationName: organization.name.slice(0, 80) },
      idempotencyKey: `portal-reset-done:${input.resetId}`,
    });
  }
}
