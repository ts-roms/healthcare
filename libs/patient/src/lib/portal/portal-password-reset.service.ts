import { Inject, Injectable, Logger } from "@nestjs/common";
import { type AuditActor, AuditService } from "@healthcare/audit";
import { hashPassword } from "@healthcare/auth";
import { DATABASE, type Database, randomToken, type RequestMetadata, sha256Hex, UnauthenticatedError } from "@healthcare/core";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { patient } from "../patient.schema";
import type { portalPasswordResetConfirmSchema, portalPasswordResetRequestSchema } from "./portal.dto";
import { patientPortalAccount, patientPortalPasswordReset } from "./portal.schema";
import { PortalAccountService } from "./portal-account.service";
import { PortalSecurityMailers } from "./portal-security-mailer";

/** How long a reset link works, how many are issued per account per hour, and how many wrong birth dates burn one. */
export const RESET_VALID_MINUTES = 30;
export const RESET_REQUESTS_PER_HOUR = 3;
export const RESET_MAX_FAILED_ATTEMPTS = 5;

const INVALID_RESET = "This link or date of birth is not correct, or the link has expired. Ask for a new link.";

/**
 * Self-service password reset for MyHealth accounts (docs/architecture/portal-app.md, "Password reset").
 *
 * - Asking never reveals whether an account exists: the answer is always the same, and a link is sent only to the
 *   sign-in email of an active account with portal consent, at most {@link RESET_REQUESTS_PER_HOUR} per hour.
 * - The link carries a random token (only its hash is stored) that works once for {@link RESET_VALID_MINUTES} minutes.
 * - The sign-in email may not be verified (a mistyped one would hand the account to a stranger), so choosing the new password also needs the patient's date of birth; wrong
 *   birth dates burn the link after {@link RESET_MAX_FAILED_ATTEMPTS}.
 * - A reset signs the account out everywhere, clears a sign-in lockout and tells the account's email it happened.
 */
@Injectable()
export class PortalPasswordResetService {
  private readonly logger = new Logger(PortalPasswordResetService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mailer: PortalSecurityMailers,
    private readonly accounts: PortalAccountService,
    private readonly audit: AuditService,
  ) {}

  async request(input: z.infer<typeof portalPasswordResetRequestSchema>, request: RequestMetadata): Promise<void> {
    const org = await this.accounts.organizationByCode(input.organizationCode);
    const anonymous: AuditActor = { kind: "anonymous", organizationId: org?.id, request };
    const refuse = (reason: string, account?: { id: string; patientId: string }) =>
      this.audit.recordStandalone(anonymous, {
        action: "portal.password-reset-request",
        resourceType: "patient_portal_account",
        resourceId: account?.id,
        patientId: account?.patientId,
        outcome: "failure",
        reason,
      });
    const [account] = org
      ? await this.db
          .select()
          .from(patientPortalAccount)
          .where(and(eq(patientPortalAccount.organizationId, org.id), eq(patientPortalAccount.email, input.email)))
      : [];
    if (!org || !account) return refuse("unknown_account");
    if (account.status !== "active") return refuse("account_not_active", account);
    if (!(await this.accounts.hasPortalConsent(this.db, org.id, account.patientId))) return refuse("portal_consent_withdrawn", account);

    const token = randomToken();
    const issued = await this.db.transaction(async (tx) => {
      // One request at a time per account, so the hourly limit cannot be raced.
      await tx.select({ id: patientPortalAccount.id }).from(patientPortalAccount).where(eq(patientPortalAccount.id, account.id)).for("update");
      const [{ recent } = { recent: 0 }] = await tx
        .select({ recent: sql<number>`count(*)::int` })
        .from(patientPortalPasswordReset)
        .where(and(eq(patientPortalPasswordReset.accountId, account.id), gt(patientPortalPasswordReset.createdAt, new Date(Date.now() - 3_600_000))));
      if (recent >= RESET_REQUESTS_PER_HOUR) return undefined;
      const now = new Date();
      await tx
        .update(patientPortalPasswordReset)
        .set({ consumedAt: now, consumedReason: "superseded" })
        .where(and(eq(patientPortalPasswordReset.accountId, account.id), isNull(patientPortalPasswordReset.consumedAt)));
      const [created] = await tx
        .insert(patientPortalPasswordReset)
        .values({
          organizationId: org.id,
          accountId: account.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(now.getTime() + RESET_VALID_MINUTES * 60_000),
          ipAddress: request.ipAddress ?? null,
          userAgent: request.userAgent?.slice(0, 512) ?? null,
        })
        .returning({ id: patientPortalPasswordReset.id });
      await this.audit.record(tx, anonymous, {
        action: "portal.password-reset-request",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId: account.patientId,
        metadata: { resetId: created!.id },
      });
      return created!;
    });
    if (!issued) return refuse("rate_limited", account);

    // The answer to the patient is the same whether or not this works; a failed send is logged and the patient asks again.
    await this.mailer
      .sendPasswordResetLink({ organizationId: org.id, patientId: account.patientId, resetId: issued.id, token, validMinutes: RESET_VALID_MINUTES })
      .catch((error: unknown) => this.logger.warn(`Password reset message ${issued.id} was not sent: ${String(error)}`));
  }

  async confirm(input: z.infer<typeof portalPasswordResetConfirmSchema>, request: RequestMetadata): Promise<void> {
    const hash = sha256Hex(input.token);
    const anonymous: AuditActor = { kind: "anonymous", request };
    const [found] = await this.db
      .select({ accountId: patientPortalPasswordReset.accountId, organizationId: patientPortalPasswordReset.organizationId })
      .from(patientPortalPasswordReset)
      .where(eq(patientPortalPasswordReset.tokenHash, hash));
    if (!found) {
      await this.audit.recordStandalone(anonymous, {
        action: "portal.password-reset",
        resourceType: "patient_portal_account",
        outcome: "failure",
        reason: "unknown_token",
      });
      throw new UnauthenticatedError(INVALID_RESET, "invalid_reset");
    }
    const passwordHash = await hashPassword(input.password);

    // Refusals are committed (attempt counts, burned links) before the caller is rejected: throwing inside would roll them back.
    const outcome = await this.db.transaction(
      async (
        tx,
      ): Promise<{ kind: "done"; patientId: string; resetId: string } | { kind: "rejected"; reason: string; patientId?: string; resetId?: string }> => {
        // Same lock order as request(): the account, then its links.
        const [row] = await tx
          .select({ account: patientPortalAccount, birthDate: patient.birthDate })
          .from(patientPortalAccount)
          .innerJoin(patient, and(eq(patient.organizationId, patientPortalAccount.organizationId), eq(patient.id, patientPortalAccount.patientId)))
          .where(and(eq(patientPortalAccount.organizationId, found.organizationId), eq(patientPortalAccount.id, found.accountId)))
          .for("update", { of: patientPortalAccount });
        const [reset] = await tx.select().from(patientPortalPasswordReset).where(eq(patientPortalPasswordReset.tokenHash, hash)).for("update");
        if (!row || !reset) return { kind: "rejected", reason: "unknown_token" };
        const account = row.account;
        const now = new Date();
        if (reset.consumedAt) return { kind: "rejected", reason: "already_used_or_replaced", patientId: account.patientId, resetId: reset.id };
        if (reset.expiresAt <= now) return { kind: "rejected", reason: "expired", patientId: account.patientId, resetId: reset.id };
        const consume = (reason: "reset" | "exhausted" | "account_inactive") =>
          tx.update(patientPortalPasswordReset).set({ consumedAt: now, consumedReason: reason }).where(eq(patientPortalPasswordReset.id, reset.id));
        if (account.status !== "active" || !(await this.accounts.hasPortalConsent(tx, account.organizationId, account.patientId))) {
          await consume("account_inactive");
          return { kind: "rejected", reason: "account_inactive", patientId: account.patientId, resetId: reset.id };
        }
        if (row.birthDate !== input.birthDate) {
          const attempts = reset.failedAttempts + 1;
          if (attempts >= RESET_MAX_FAILED_ATTEMPTS) await consume("exhausted");
          else await tx.update(patientPortalPasswordReset).set({ failedAttempts: attempts }).where(eq(patientPortalPasswordReset.id, reset.id));
          return {
            kind: "rejected",
            reason: attempts >= RESET_MAX_FAILED_ATTEMPTS ? "birth_date_attempts_exhausted" : "birth_date_mismatch",
            patientId: account.patientId,
            resetId: reset.id,
          };
        }
        await tx
          .update(patientPortalAccount)
          .set({ passwordHash, failedAttempts: 0, lockedUntil: null, updatedAt: now, version: sql`${patientPortalAccount.version} + 1` })
          .where(eq(patientPortalAccount.id, account.id));
        await consume("reset");
        await tx
          .update(patientPortalPasswordReset)
          .set({ consumedAt: now, consumedReason: "superseded" })
          .where(and(eq(patientPortalPasswordReset.accountId, account.id), isNull(patientPortalPasswordReset.consumedAt)));
        await this.accounts.revokeAll(tx, account.id, "password_reset");
        await this.audit.record(
          tx,
          { kind: "patient", accountId: account.id, patientId: account.patientId, organizationId: account.organizationId, request },
          { action: "portal.password-reset", resourceType: "patient_portal_account", resourceId: account.id, metadata: { resetId: reset.id } },
        );
        return { kind: "done", patientId: account.patientId, resetId: reset.id };
      },
    );

    if (outcome.kind === "rejected") {
      await this.audit.recordStandalone(
        { kind: "anonymous", organizationId: found.organizationId, request },
        {
          action: "portal.password-reset",
          resourceType: "patient_portal_account",
          resourceId: found.accountId,
          patientId: outcome.patientId,
          outcome: "failure",
          reason: outcome.reason,
          metadata: outcome.resetId ? { resetId: outcome.resetId } : undefined,
        },
      );
      throw new UnauthenticatedError(INVALID_RESET, "invalid_reset");
    }
    await this.mailer
      .sendPasswordChanged({ organizationId: found.organizationId, patientId: outcome.patientId, resetId: outcome.resetId })
      .catch((error: unknown) => this.logger.warn(`Password change notice ${outcome.resetId} was not sent: ${String(error)}`));
  }
}
