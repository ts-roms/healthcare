import { randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { BusinessRuleError, ConflictError, DATABASE, type Database, maskEmail } from "@healthcare/core";
import { and, count, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { patientPortalAccount, patientPortalEmailVerification, patientPortalSession } from "../portal/portal.schema";
import { PortalAccountService, type PortalPrincipal } from "../portal/portal-account.service";
import { PortalSecurityMailers } from "../portal/portal-security-mailer";
import { PortalMfaService } from "./portal-mfa.service";
import {
  generateVerificationCode,
  hashVerificationCode,
  VERIFICATION_MAX_FAILED_ATTEMPTS,
  VERIFICATION_RESEND_SECONDS,
  VERIFICATION_SENDS_PER_HOUR,
  VERIFICATION_VALID_MINUTES,
} from "./portal-security.rules";

export interface PortalEmailStatusView {
  email: string;
  verified: boolean;
  verifiedAt: string | null;
  /** A code was sent and is waiting to be entered: to the current email, or to a new address being switched to. */
  pending: { emailMasked: string; isChange: boolean; expiresAt: string } | null;
}

const WRONG_CODE = "That code is not correct, or it has expired. Ask for a new code.";

/**
 * The sign-in email of a MyHealth account (docs/architecture/portal-app.md, "Email verification"): proven by a six-digit
 * code sent to it, which the signed-in patient enters; and changed the same way — the new address must prove itself
 * before it replaces the old one, which is told.
 *
 * A code lives 15 minutes and 5 tries, only its hash (bound to the attempt) is stored, a new one replaces older ones,
 * and sending is limited to one a minute and five an hour.
 */
@Injectable()
export class PortalEmailService {
  private readonly logger = new Logger(PortalEmailService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly accounts: PortalAccountService,
    private readonly mfa: PortalMfaService,
    private readonly mailer: PortalSecurityMailers,
    private readonly audit: AuditService,
  ) {}

  async status(principal: PortalPrincipal): Promise<PortalEmailStatusView> {
    const account = await this.accounts.accountOf(principal);
    const pending = await this.activeVerification(account.id);
    return {
      email: account.email ?? "",
      verified: Boolean(account.emailVerifiedAt),
      verifiedAt: account.emailVerifiedAt?.toISOString() ?? null,
      pending: pending
        ? { emailMasked: maskEmail(pending.email), isChange: pending.email !== account.email, expiresAt: pending.expiresAt.toISOString() }
        : null,
    };
  }

  /** Sends a code to the current sign-in email, which is not yet verified. */
  async sendCode(principal: PortalPrincipal): Promise<{ sentTo: string; validMinutes: number }> {
    const account = await this.accounts.accountOf(principal);
    if (!account.email) throw new BusinessRuleError("There is no email on this account", "no_email");
    if (account.emailVerifiedAt) throw new ConflictError("This email is already verified", undefined, "email_already_verified");
    return this.issue(principal, account.email);
  }

  /** Starts switching the sign-in email: the new address gets a code and replaces the old one only when it is entered. */
  async requestChange(
    principal: PortalPrincipal,
    input: { newEmail: string; password: string; code?: string },
  ): Promise<{ sentTo: string; validMinutes: number }> {
    const account = await this.accounts.confirmPassword(principal, input.password);
    if (account.mfaEnabled) {
      if (!input.code) throw new BusinessRuleError("Enter the code from your authenticator app", "mfa_code_required");
      await this.mfa.requireSecondFactor(principal, input.code, true);
    }
    if (input.newEmail === account.email) throw new BusinessRuleError("That is already your sign-in email", "email_unchanged");
    const [taken] = await this.db
      .select({ id: patientPortalAccount.id })
      .from(patientPortalAccount)
      .where(and(eq(patientPortalAccount.organizationId, account.organizationId), eq(patientPortalAccount.email, input.newEmail)));
    if (taken) throw new ConflictError("This email is already used for another portal account", undefined, "email_in_use");
    return this.issue(principal, input.newEmail);
  }

  /** Enters the code: verifies the current email, or completes a change of it. */
  async confirm(principal: PortalPrincipal, code: string): Promise<{ email: string; changed: boolean }> {
    const outcome = await this.db.transaction(
      async (
        tx,
      ): Promise<
        | { kind: "ok"; email: string; changed: boolean; previous: string | null; patientId: string; organizationId: string }
        | { kind: "bad" }
        | { kind: "taken" }
      > => {
        const [account] = await tx
          .select()
          .from(patientPortalAccount)
          .where(and(eq(patientPortalAccount.organizationId, principal.organizationId), eq(patientPortalAccount.id, principal.accountId)))
          .for("update");
        if (!account) return { kind: "bad" };
        const [verification] = await tx
          .select()
          .from(patientPortalEmailVerification)
          .where(and(eq(patientPortalEmailVerification.accountId, account.id), isNull(patientPortalEmailVerification.consumedAt)))
          .orderBy(desc(patientPortalEmailVerification.createdAt))
          .limit(1)
          .for("update");
        const now = new Date();
        if (!verification || verification.expiresAt <= now) return { kind: "bad" };
        const expected = Buffer.from(verification.codeHash);
        const given = Buffer.from(hashVerificationCode(verification.id, code));
        if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
          const attempts = verification.failedAttempts + 1;
          const exhausted = attempts >= VERIFICATION_MAX_FAILED_ATTEMPTS;
          await tx
            .update(patientPortalEmailVerification)
            .set(exhausted ? { failedAttempts: attempts, consumedAt: now, consumedReason: "exhausted" } : { failedAttempts: attempts })
            .where(eq(patientPortalEmailVerification.id, verification.id));
          await this.audit.record(tx, this.accounts.principalContext(principal), {
            action: "portal.email-verify",
            resourceType: "patient_portal_account",
            resourceId: account.id,
            patientId: account.patientId,
            outcome: "failure",
            reason: exhausted ? "attempts_exhausted" : "wrong_code",
          });
          return { kind: "bad" };
        }
        const changed = verification.email !== account.email;
        if (changed) {
          const [taken] = await tx
            .select({ id: patientPortalAccount.id })
            .from(patientPortalAccount)
            .where(
              and(
                eq(patientPortalAccount.organizationId, account.organizationId),
                eq(patientPortalAccount.email, verification.email),
                ne(patientPortalAccount.id, account.id),
              ),
            );
          if (taken) {
            await tx
              .update(patientPortalEmailVerification)
              .set({ consumedAt: now, consumedReason: "superseded" })
              .where(eq(patientPortalEmailVerification.id, verification.id));
            return { kind: "taken" };
          }
        }
        await tx
          .update(patientPortalAccount)
          .set({ ...(changed ? { email: verification.email } : {}), emailVerifiedAt: now, updatedAt: now })
          .where(eq(patientPortalAccount.id, account.id));
        await tx
          .update(patientPortalEmailVerification)
          .set({ consumedAt: now, consumedReason: "verified" })
          .where(eq(patientPortalEmailVerification.id, verification.id));
        if (changed) {
          // A new address means this session is the one the patient trusts: every other one ends.
          await tx
            .update(patientPortalSession)
            .set({ revokedAt: now, revokedReason: "email_changed" })
            .where(
              and(eq(patientPortalSession.accountId, account.id), isNull(patientPortalSession.revokedAt), ne(patientPortalSession.id, principal.sessionId)),
            );
        }
        await this.audit.record(tx, this.accounts.principalContext(principal), {
          action: changed ? "portal.email-change" : "portal.email-verify",
          resourceType: "patient_portal_account",
          resourceId: account.id,
          patientId: account.patientId,
        });
        return {
          kind: "ok",
          email: verification.email,
          changed,
          previous: account.email,
          patientId: account.patientId,
          organizationId: account.organizationId,
        };
      },
    );
    if (outcome.kind === "taken") throw new ConflictError("This email is already used for another portal account", undefined, "email_in_use");
    if (outcome.kind === "bad") throw new BusinessRuleError(WRONG_CODE, "invalid_verification_code");
    if (outcome.changed && outcome.previous) {
      await this.mailer
        .sendSecurityAlert({
          organizationId: outcome.organizationId,
          patientId: outcome.patientId,
          eventId: randomUUID(),
          event: "email_changed",
          detail: maskEmail(outcome.email),
          to: outcome.previous,
        })
        .catch((error: unknown) => this.logger.warn(`Email change notice was not sent: ${String(error)}`));
    }
    return { email: outcome.email, changed: outcome.changed };
  }

  // ---- internals ------------------------------------------------------------------------

  private async activeVerification(accountId: string) {
    const [row] = await this.db
      .select()
      .from(patientPortalEmailVerification)
      .where(
        and(
          eq(patientPortalEmailVerification.accountId, accountId),
          isNull(patientPortalEmailVerification.consumedAt),
          gt(patientPortalEmailVerification.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(patientPortalEmailVerification.createdAt))
      .limit(1);
    return row;
  }

  /** Makes a code for an address and sends it, within the sending limits. */
  private async issue(principal: PortalPrincipal, email: string): Promise<{ sentTo: string; validMinutes: number }> {
    const id = randomUUID();
    const code = generateVerificationCode();
    const patientId = await this.db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(patientPortalAccount)
        .where(and(eq(patientPortalAccount.organizationId, principal.organizationId), eq(patientPortalAccount.id, principal.accountId)))
        .for("update");
      if (!account) throw new BusinessRuleError("Your session has ended", "session_ended");
      const now = new Date();
      const [latest] = await tx
        .select({ createdAt: patientPortalEmailVerification.createdAt })
        .from(patientPortalEmailVerification)
        .where(eq(patientPortalEmailVerification.accountId, account.id))
        .orderBy(desc(patientPortalEmailVerification.createdAt))
        .limit(1);
      if (latest && now.getTime() - latest.createdAt.getTime() < VERIFICATION_RESEND_SECONDS * 1000) {
        throw new BusinessRuleError(`Wait a minute before asking for another code`, "verification_too_soon");
      }
      const [{ recent } = { recent: 0 }] = await tx
        .select({ recent: count() })
        .from(patientPortalEmailVerification)
        .where(
          and(eq(patientPortalEmailVerification.accountId, account.id), gt(patientPortalEmailVerification.createdAt, new Date(now.getTime() - 3_600_000))),
        );
      if (recent >= VERIFICATION_SENDS_PER_HOUR) {
        throw new BusinessRuleError("Too many codes were sent in the last hour. Try again later.", "verification_rate_limited");
      }
      await tx
        .update(patientPortalEmailVerification)
        .set({ consumedAt: now, consumedReason: "superseded" })
        .where(and(eq(patientPortalEmailVerification.accountId, account.id), isNull(patientPortalEmailVerification.consumedAt)));
      await tx.insert(patientPortalEmailVerification).values({
        id,
        organizationId: account.organizationId,
        accountId: account.id,
        email,
        codeHash: hashVerificationCode(id, code),
        expiresAt: new Date(now.getTime() + VERIFICATION_VALID_MINUTES * 60_000),
      });
      await this.audit.record(tx, this.accounts.principalContext(principal), {
        action: "portal.email-verification-send",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId: account.patientId,
        metadata: { verificationId: id, change: email !== account.email },
      });
      return account.patientId;
    });
    await this.mailer.sendEmailVerificationCode({
      organizationId: principal.organizationId,
      patientId,
      verificationId: id,
      email,
      code,
      validMinutes: VERIFICATION_VALID_MINUTES,
    });
    return { sentTo: maskEmail(email), validMinutes: VERIFICATION_VALID_MINUTES };
  }
}
