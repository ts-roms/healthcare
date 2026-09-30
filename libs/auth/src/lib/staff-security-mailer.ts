import { Injectable, Logger } from "@nestjs/common";

/**
 * Sends the security messages of a staff account (a password-reset link, a notice that the password changed). A port:
 * the notification platform is wired in the API (`apps/api/src/app/staff-security-notices.ts`); the token travels only
 * here, never through domain events. The message is recorded under `organizationId` (one of the person's organizations).
 */
export interface StaffSecurityMailer {
  sendPasswordResetLink(input: { organizationId: string; userId: string; resetId: string; token: string; validMinutes: number }): Promise<void>;
  sendPasswordChanged(input: { organizationId: string; userId: string; resetId: string }): Promise<void>;
}

/** Holds the mailer the application registers at start-up (the notification platform depends on this library). */
@Injectable()
export class StaffSecurityMailers implements StaffSecurityMailer {
  private readonly logger = new Logger(StaffSecurityMailers.name);
  private delegate: StaffSecurityMailer | undefined;

  register(mailer: StaffSecurityMailer): void {
    this.delegate = mailer;
  }

  async sendPasswordResetLink(input: Parameters<StaffSecurityMailer["sendPasswordResetLink"]>[0]): Promise<void> {
    if (!this.delegate) return this.logger.warn("No mailer is registered: the staff password reset link was not sent");
    await this.delegate.sendPasswordResetLink(input);
  }

  async sendPasswordChanged(input: Parameters<StaffSecurityMailer["sendPasswordChanged"]>[0]): Promise<void> {
    await this.delegate?.sendPasswordChanged(input);
  }
}
