import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG, type AppConfig, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PortalSecurityMailers, type PortalSecurityMailer, type SecurityAlertEvent } from "@healthcare/patient";

/**
 * Security messages of a MyHealth account (docs/architecture/portal-app.md, "Password reset", "Email verification",
 * "Two-step verification"): the reset link, verification codes and notices of security changes, by email through
 * `NotificationService` to the account's sign-in email (`AppRecipientDirectory` resolves it; no communication preference
 * applies) — or to the address being verified or just left, which the caller names. The reset link points at the
 * portal's public address (`PORTAL_BASE_URL`) with the token in the fragment, which browsers do not send to servers or
 * in Referer headers; without that address no link is sent.
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

  async sendEmailVerificationCode(input: {
    organizationId: string;
    patientId: string;
    verificationId: string;
    email: string;
    code: string;
    validMinutes: number;
  }): Promise<void> {
    // The code is a credential: in development, with no mail provider, it is here so the flow can be tried.
    if (this.config.NODE_ENV === "development") this.logger.warn(`MyHealth verification code for ${input.email} (development only): ${input.code}`);
    const organization = await this.organizations.getOrganization(input.organizationId);
    await this.notifications.send(
      systemActor(input.organizationId, null, "portal-email-verification"),
      {
        recipient: { type: "patient", patientId: input.patientId },
        channel: "email",
        templateKey: "portal.email-verification",
        variables: { organizationName: organization.name.slice(0, 80), code: input.code, validMinutes: input.validMinutes },
        idempotencyKey: `portal-email-verification:${input.verificationId}`,
      },
      // The address being proven: not necessarily the one on the account yet.
      { securityDestination: input.email },
    );
  }

  async sendSecurityAlert(input: {
    organizationId: string;
    patientId: string;
    eventId: string;
    event: SecurityAlertEvent;
    detail?: string;
    to?: string;
  }): Promise<void> {
    const organization = await this.organizations.getOrganization(input.organizationId);
    await this.notifications.send(
      systemActor(input.organizationId, null, "portal-security-alert"),
      {
        recipient: { type: "patient", patientId: input.patientId },
        channel: "email",
        templateKey: "portal.security-alert",
        variables: { organizationName: organization.name.slice(0, 80), event: input.event, ...(input.detail ? { detail: input.detail } : {}) },
        idempotencyKey: `portal-security-alert:${input.eventId}`,
      },
      input.to ? { securityDestination: input.to } : {},
    );
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
