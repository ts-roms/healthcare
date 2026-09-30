import { Injectable, Logger } from "@nestjs/common";

export const SECURITY_ALERT_EVENTS = [
  "mfa_enabled",
  "mfa_disabled",
  "mfa_reset_by_clinic",
  "recovery_code_used",
  "recovery_codes_renewed",
  "email_changed",
] as const;
export type SecurityAlertEvent = (typeof SECURITY_ALERT_EVENTS)[number];

/**
 * Sends the security messages of a MyHealth account. A port: the notification platform is wired in the API (adapters),
 * and secrets (a reset token, a verification code) never travel through domain events, whose payloads carry ids only.
 * A message goes to the account's sign-in email unless `to` names another address (the one being verified, or the one
 * an account just left).
 */
export interface PortalSecurityMailer {
  sendPasswordResetLink(input: { organizationId: string; patientId: string; resetId: string; token: string; validMinutes: number }): Promise<void>;
  sendPasswordChanged(input: { organizationId: string; patientId: string; resetId: string }): Promise<void>;
  sendEmailVerificationCode(input: {
    organizationId: string;
    patientId: string;
    verificationId: string;
    email: string;
    code: string;
    validMinutes: number;
  }): Promise<void>;
  sendSecurityAlert(input: {
    organizationId: string;
    patientId: string;
    eventId: string;
    event: SecurityAlertEvent;
    detail?: string;
    to?: string;
  }): Promise<void>;
}

/**
 * Holds the mailer the application registers at start-up (the patient module is imported by domains the notification
 * platform itself depends on, so it cannot import the notification platform). Until one is registered, nothing is sent.
 */
@Injectable()
export class PortalSecurityMailers implements PortalSecurityMailer {
  private readonly logger = new Logger(PortalSecurityMailers.name);
  private delegate: PortalSecurityMailer | undefined;

  register(mailer: PortalSecurityMailer): void {
    this.delegate = mailer;
  }

  async sendPasswordResetLink(input: Parameters<PortalSecurityMailer["sendPasswordResetLink"]>[0]): Promise<void> {
    if (!this.delegate) return this.logger.warn("No mailer is registered: the password reset link was not sent");
    await this.delegate.sendPasswordResetLink(input);
  }

  async sendPasswordChanged(input: Parameters<PortalSecurityMailer["sendPasswordChanged"]>[0]): Promise<void> {
    await this.delegate?.sendPasswordChanged(input);
  }

  async sendEmailVerificationCode(input: Parameters<PortalSecurityMailer["sendEmailVerificationCode"]>[0]): Promise<void> {
    if (!this.delegate) return this.logger.warn("No mailer is registered: the verification code was not sent");
    await this.delegate.sendEmailVerificationCode(input);
  }

  async sendSecurityAlert(input: Parameters<PortalSecurityMailer["sendSecurityAlert"]>[0]): Promise<void> {
    await this.delegate?.sendSecurityAlert(input);
  }
}
