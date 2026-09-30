import { Inject, Injectable, Logger } from "@nestjs/common";
import { type AnonymousAuditContext, AuditService } from "@healthcare/audit";
import {
  APP_CONFIG,
  type AppConfig,
  DATABASE,
  type Database,
  decryptSecret,
  randomToken,
  type RequestMetadata,
  sha256Hex,
  UnauthenticatedError,
} from "@healthcare/core";
import { organization } from "@healthcare/organization";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { appUser, organizationMembership, staffPasswordReset } from "./auth.schema";
import type { staffPasswordResetRequestSchema, staffPasswordResetSchema } from "./auth.dto";
import { hashPassword } from "./password";
import { SessionService } from "./session.service";
import { StaffSecurityMailers } from "./staff-security-mailer";
import { verifyTotp } from "./totp";

/** How long a link works, how many are issued per account per hour, and how many wrong codes burn one. */
export const STAFF_RESET_VALID_MINUTES = 30;
export const STAFF_RESET_REQUESTS_PER_HOUR = 3;
export const STAFF_RESET_MAX_FAILED_ATTEMPTS = 5;

const INVALID_RESET = "This link or code is not correct, or the link has expired. Ask for a new link.";

type Outcome =
  { kind: "done"; userId: string; resetId: string } | { kind: "rejected"; reason: string; userId?: string; resetId?: string; codeRequired?: boolean };

/**
 * Self-service password reset for staff (docs/security/access-control.md, "Password reset by email"; migration 0091).
 *
 * - Asking never reveals whether an account exists: the answer is always the same. A link goes only to the sign-in
 *   email of an active staff account with an active membership, at most {@link STAFF_RESET_REQUESTS_PER_HOUR} per hour.
 * - The link carries a random token (only its hash is stored) that works once for {@link STAFF_RESET_VALID_MINUTES} minutes.
 * - With two-step verification on, the new password also needs a current code (someone reading the mailbox alone cannot
 *   take the account); wrong codes burn the link after {@link STAFF_RESET_MAX_FAILED_ATTEMPTS}.
 * - A reset ends every session, clears a lockout and a temporary password, and tells the account's email it happened.
 */
@Injectable()
export class StaffPasswordResetService {
  private readonly logger = new Logger(StaffPasswordResetService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly mailer: StaffSecurityMailers,
  ) {}

  async request(input: z.infer<typeof staffPasswordResetRequestSchema>, request: RequestMetadata): Promise<void> {
    const anonymous: AnonymousAuditContext = { kind: "anonymous", request };
    const refuse = (reason: string, userId?: string) =>
      this.audit.recordStandalone(
        { ...anonymous, userId },
        { action: "auth.password-reset-request", resourceType: "app_user", resourceId: userId, outcome: "failure", reason },
      );
    const [user] = await this.db.select().from(appUser).where(eq(appUser.email, input.email));
    if (!user || user.kind !== "staff") return refuse("unknown_account");
    if (user.status !== "active") return refuse("account_not_active", user.id);
    // The message is recorded under one of the person's organizations (the one they joined first).
    const [membership] = await this.db
      .select({ organizationId: organizationMembership.organizationId })
      .from(organizationMembership)
      .innerJoin(organization, eq(organization.id, organizationMembership.organizationId))
      .where(and(eq(organizationMembership.userId, user.id), eq(organizationMembership.status, "active"), eq(organization.status, "active")))
      .orderBy(asc(organizationMembership.createdAt))
      .limit(1);
    if (!membership) return refuse("no_active_membership", user.id);

    const token = randomToken();
    const issued = await this.db.transaction(async (tx) => {
      // One request at a time per account, so the hourly limit cannot be raced.
      await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.id, user.id)).for("update");
      const [{ recent } = { recent: 0 }] = await tx
        .select({ recent: sql<number>`count(*)::int` })
        .from(staffPasswordReset)
        .where(and(eq(staffPasswordReset.userId, user.id), gt(staffPasswordReset.createdAt, new Date(Date.now() - 3_600_000))));
      if (recent >= STAFF_RESET_REQUESTS_PER_HOUR) return undefined;
      const now = new Date();
      await tx
        .update(staffPasswordReset)
        .set({ consumedAt: now, consumedReason: "superseded" })
        .where(and(eq(staffPasswordReset.userId, user.id), isNull(staffPasswordReset.consumedAt)));
      const [created] = await tx
        .insert(staffPasswordReset)
        .values({
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(now.getTime() + STAFF_RESET_VALID_MINUTES * 60_000),
          ipAddress: request.ipAddress ?? null,
          userAgent: request.userAgent?.slice(0, 512) ?? null,
        })
        .returning({ id: staffPasswordReset.id });
      await this.audit.record(
        tx,
        { ...anonymous, userId: user.id, organizationId: membership.organizationId },
        { action: "auth.password-reset-request", resourceType: "app_user", resourceId: user.id, metadata: { resetId: created!.id } },
      );
      return created!;
    });
    if (!issued) return refuse("rate_limited", user.id);
    // The answer is the same whether or not this works; a failed send is logged and the person asks again.
    await this.mailer
      .sendPasswordResetLink({
        organizationId: membership.organizationId,
        userId: user.id,
        resetId: issued.id,
        token,
        validMinutes: STAFF_RESET_VALID_MINUTES,
      })
      .catch((error: unknown) => this.logger.warn(`Staff password reset message ${issued.id} was not sent: ${String(error)}`));
  }

  async confirm(input: z.infer<typeof staffPasswordResetSchema>, request: RequestMetadata): Promise<void> {
    const hash = sha256Hex(input.token);
    const passwordHash = await hashPassword(input.password);
    // Refusals are committed (attempt counts, burned links) before the caller is rejected: throwing inside would roll them back.
    const outcome = await this.db.transaction(async (tx): Promise<Outcome> => {
      const [link] = await tx.select({ userId: staffPasswordReset.userId }).from(staffPasswordReset).where(eq(staffPasswordReset.tokenHash, hash));
      if (!link) return { kind: "rejected", reason: "unknown_token" };
      // Same lock order as request(): the account, then its links.
      const [user] = await tx.select().from(appUser).where(eq(appUser.id, link.userId)).for("update");
      const [reset] = await tx.select().from(staffPasswordReset).where(eq(staffPasswordReset.tokenHash, hash)).for("update");
      if (!user || !reset) return { kind: "rejected", reason: "unknown_token" };
      const now = new Date();
      const base = { userId: user.id, resetId: reset.id };
      if (reset.consumedAt) return { kind: "rejected", reason: "already_used_or_replaced", ...base };
      if (reset.expiresAt <= now) return { kind: "rejected", reason: "expired", ...base };
      const consume = (reason: "reset" | "exhausted" | "account_inactive") =>
        tx.update(staffPasswordReset).set({ consumedAt: now, consumedReason: reason }).where(eq(staffPasswordReset.id, reset.id));
      if (user.status !== "active") {
        await consume("account_inactive");
        return { kind: "rejected", reason: "account_inactive", ...base };
      }
      if (user.mfaEnabled && user.mfaSecretEncrypted) {
        if (!input.code) return { kind: "rejected", reason: "mfa_code_required", codeRequired: true, ...base };
        if (!verifyTotp(decryptSecret(user.mfaSecretEncrypted, this.config.MFA_ENCRYPTION_KEY), input.code)) {
          const attempts = reset.failedAttempts + 1;
          if (attempts >= STAFF_RESET_MAX_FAILED_ATTEMPTS) await consume("exhausted");
          else await tx.update(staffPasswordReset).set({ failedAttempts: attempts }).where(eq(staffPasswordReset.id, reset.id));
          return { kind: "rejected", reason: attempts >= STAFF_RESET_MAX_FAILED_ATTEMPTS ? "code_attempts_exhausted" : "wrong_mfa_code", ...base };
        }
      }
      await tx
        .update(appUser)
        .set({
          passwordHash,
          passwordChangedAt: now,
          passwordChangeRequired: false,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: now,
          version: sql`${appUser.version} + 1`,
        })
        .where(eq(appUser.id, user.id));
      await consume("reset");
      await tx
        .update(staffPasswordReset)
        .set({ consumedAt: now, consumedReason: "superseded" })
        .where(and(eq(staffPasswordReset.userId, user.id), isNull(staffPasswordReset.consumedAt)));
      const revoked = await this.sessions.revokeAllForUser(tx, user.id, "password_reset");
      await this.audit.record(
        tx,
        { kind: "anonymous", userId: user.id, request },
        { action: "auth.password-reset", resourceType: "app_user", resourceId: user.id, metadata: { resetId: reset.id, sessionsRevoked: revoked } },
      );
      return { kind: "done", ...base };
    });

    if (outcome.kind === "rejected") {
      await this.audit.recordStandalone(
        { kind: "anonymous", userId: outcome.userId, request },
        {
          action: "auth.password-reset",
          resourceType: "app_user",
          resourceId: outcome.userId,
          outcome: "failure",
          reason: outcome.reason,
          metadata: outcome.resetId ? { resetId: outcome.resetId } : undefined,
        },
      );
      if (outcome.codeRequired) throw new UnauthenticatedError("Enter a code from your authenticator app", "mfa_code_required");
      throw new UnauthenticatedError(INVALID_RESET, "invalid_reset");
    }
    const [membership] = await this.db
      .select({ organizationId: organizationMembership.organizationId })
      .from(organizationMembership)
      .where(and(eq(organizationMembership.userId, outcome.userId), eq(organizationMembership.status, "active")))
      .orderBy(asc(organizationMembership.createdAt))
      .limit(1);
    if (membership) {
      await this.mailer
        .sendPasswordChanged({ organizationId: membership.organizationId, userId: outcome.userId, resetId: outcome.resetId })
        .catch((error: unknown) => this.logger.warn(`Staff password change notice ${outcome.resetId} was not sent: ${String(error)}`));
    }
  }
}
