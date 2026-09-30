import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { type StaffSecurityMailer, StaffSecurityMailers } from "@healthcare/auth";
import { APP_CONFIG, type AppConfig, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";

/**
 * Security messages of a staff account (docs/security/access-control.md, "Password reset by email"): the reset link and
 * the notice that the password changed, by email through `NotificationService` to the account's sign-in email
 * (`AppRecipientDirectory` resolves it). The link points at the staff app's public address (`STAFF_BASE_URL`) with the
 * token in the fragment, which browsers do not send to servers or in Referer headers; without that address no link is sent.
 */
@Injectable()
export class StaffSecurityNotices implements StaffSecurityMailer, OnModuleInit {
  private readonly logger = new Logger(StaffSecurityNotices.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailers: StaffSecurityMailers,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.mailers.register(this);
  }

  async sendPasswordResetLink(input: { organizationId: string; userId: string; resetId: string; token: string; validMinutes: number }): Promise<void> {
    const base = this.config.STAFF_BASE_URL;
    if (!base) {
      this.logger.warn("STAFF_BASE_URL is not set: the staff password reset link was not sent");
      return;
    }
    const link = `${base}/reset-password#token=${input.token}`;
    // The link is a credential: in development, with no mail provider, it is here so the flow can be tried.
    if (this.config.NODE_ENV === "development") this.logger.warn(`Staff password reset link (development only): ${link}`);
    await this.notifications.send(systemActor(input.organizationId, null, "staff-password-reset"), {
      recipient: { type: "user", userId: input.userId },
      channel: "email",
      templateKey: "staff.password-reset",
      variables: { link, validMinutes: input.validMinutes },
      idempotencyKey: `staff-reset:${input.resetId}`,
    });
  }

  async sendPasswordChanged(input: { organizationId: string; userId: string; resetId: string }): Promise<void> {
    await this.notifications.send(systemActor(input.organizationId, null, "staff-password-reset"), {
      recipient: { type: "user", userId: input.userId },
      channel: "email",
      templateKey: "staff.password-changed",
      variables: {},
      idempotencyKey: `staff-reset-done:${input.resetId}`,
    });
  }
}
