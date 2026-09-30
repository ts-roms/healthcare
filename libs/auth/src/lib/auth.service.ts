import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type AnonymousAuditContext } from "@healthcare/audit";
import {
  type Actor,
  APP_CONFIG,
  type AppConfig,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  decryptSecret,
  encryptSecret,
  ForbiddenError,
  type RequestMetadata,
  UnauthenticatedError,
} from "@healthcare/core";
import { organization } from "@healthcare/organization";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { appUser, type AppUserRecord, organizationMembership } from "./auth.schema";
import type { changePasswordSchema, loginSchema, MfaRequiredResponse, TokenResponse } from "./auth.dto";
import { burnPasswordVerification, hashPassword, verifyPassword } from "./password";
import { SessionService } from "./session.service";
import { TokenService } from "./tokens";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const invalidCredentials = () => new UnauthenticatedError("Invalid email or password", "invalid_credentials");

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
  ) {}

  async login(input: z.infer<typeof loginSchema>, request: RequestMetadata): Promise<TokenResponse | MfaRequiredResponse> {
    const anonymous: AnonymousAuditContext = { kind: "anonymous", request };
    const [user] = await this.db.select().from(appUser).where(eq(appUser.email, input.email));
    if (!user) {
      await burnPasswordVerification(input.password);
      await this.audit.recordStandalone(anonymous, {
        action: "auth.login",
        resourceType: "app_user",
        outcome: "failure",
        reason: "unknown_email",
        metadata: { email: input.email },
      });
      throw invalidCredentials();
    }
    const context: AnonymousAuditContext = { ...anonymous, userId: user.id };

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.recordStandalone(context, {
        action: "auth.login",
        resourceType: "app_user",
        resourceId: user.id,
        outcome: "denied",
        reason: "account_locked",
      });
      throw new UnauthenticatedError("Too many failed attempts. Try again later.", "account_locked");
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.recordFailedAttempt(user, context, "wrong_password");
      throw invalidCredentials();
    }
    if (user.status !== "active") {
      await this.audit.recordStandalone(context, {
        action: "auth.login",
        resourceType: "app_user",
        resourceId: user.id,
        outcome: "denied",
        reason: "account_disabled",
      });
      throw new UnauthenticatedError("This account is disabled", "account_disabled");
    }

    const organizationId = await this.selectOrganization(user.id, input.organizationId, context);

    if (user.mfaEnabled) {
      await this.audit.recordStandalone(
        { ...context, organizationId },
        {
          action: "auth.login.mfa-challenge",
          resourceType: "app_user",
          resourceId: user.id,
        },
      );
      return { status: "mfa_required", challengeToken: await this.tokens.signMfaChallenge({ sub: user.id, org: organizationId }) };
    }
    return this.completeLogin(user, organizationId, request, "password");
  }

  async verifyMfa(challengeToken: string, code: string, request: RequestMetadata): Promise<TokenResponse> {
    const claims = await this.tokens.verifyMfaChallenge(challengeToken);
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, claims.sub));
    if (!user || user.status !== "active" || !user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new UnauthenticatedError("Invalid or expired token", "invalid_token");
    }
    const context: AnonymousAuditContext = { kind: "anonymous", userId: user.id, organizationId: claims.org, request };
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthenticatedError("Too many failed attempts. Try again later.", "account_locked");
    }
    if (!verifyTotp(decryptSecret(user.mfaSecretEncrypted, this.config.MFA_ENCRYPTION_KEY), code)) {
      await this.recordFailedAttempt(user, context, "wrong_mfa_code");
      throw new UnauthenticatedError("Invalid verification code", "invalid_mfa_code");
    }
    // Membership may have changed during the challenge window.
    await this.selectOrganization(user.id, claims.org, context);
    return this.completeLogin(user, claims.org, request, "password+totp");
  }

  async refresh(refreshToken: string, request: RequestMetadata): Promise<TokenResponse> {
    const result = await this.sessions.rotate(refreshToken);
    if (result.kind === "reuse_detected") {
      await this.audit.recordStandalone(
        { kind: "anonymous", userId: result.session.userId, organizationId: result.session.organizationId ?? undefined, request },
        {
          action: "auth.session.revoke",
          resourceType: "auth_session",
          resourceId: result.session.id,
          outcome: "denied",
          reason: "refresh_token_reuse",
        },
      );
      throw SessionService.invalid();
    }
    if (result.kind !== "rotated" || !result.session.organizationId) throw SessionService.invalid();
    const { session } = result;
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, session.userId));
    const organizationId = session.organizationId;
    if (!user || user.status !== "active" || !organizationId || !(await this.hasActiveMembership(user.id, organizationId))) {
      await this.sessions.revoke(this.db, session.id, "access_revoked");
      throw SessionService.invalid();
    }
    return this.tokenResponse(user.id, session.id, organizationId, result.refreshToken, session.expiresAt);
  }

  async logout(actor: Actor): Promise<void> {
    if (!actor.sessionId) return;
    const sessionId = actor.sessionId;
    await this.db.transaction(async (tx) => {
      await this.sessions.revoke(tx, sessionId, "logout");
      await this.audit.record(tx, actor, { action: "auth.logout", resourceType: "auth_session", resourceId: sessionId });
    });
  }

  async changePassword(actor: Actor, input: z.infer<typeof changePasswordSchema>): Promise<void> {
    const user = await this.getUser(actor.userId);
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      await this.audit.recordStandalone(actor, {
        action: "auth.password.change",
        resourceType: "app_user",
        resourceId: user.id,
        outcome: "failure",
        reason: "wrong_password",
      });
      throw new BusinessRuleError("Current password is incorrect", "invalid_current_password");
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx
        .update(appUser)
        .set({ passwordHash, passwordChangedAt: new Date(), passwordChangeRequired: false, updatedAt: new Date(), version: sql`${appUser.version} + 1` })
        .where(eq(appUser.id, user.id));
      const revoked = await this.sessions.revokeAllForUser(tx, user.id, "password_changed", actor.sessionId);
      await this.audit.record(tx, actor, {
        action: "auth.password.change",
        resourceType: "app_user",
        resourceId: user.id,
        metadata: { otherSessionsRevoked: revoked, replacedTemporary: user.passwordChangeRequired },
      });
    });
  }

  /** Step 1 of MFA enrollment: a new secret, pending until confirmed with a code. */
  async beginMfaSetup(actor: Actor): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.getUser(actor.userId);
    if (user.mfaEnabled) throw new ConflictError("Multi-factor authentication is already enabled", undefined, "mfa_already_enabled");
    const secret = generateTotpSecret();
    await this.db.transaction(async (tx) => {
      await tx
        .update(appUser)
        .set({ mfaPendingSecretEncrypted: encryptSecret(secret, this.config.MFA_ENCRYPTION_KEY), updatedAt: new Date() })
        .where(eq(appUser.id, user.id));
      await this.audit.record(tx, actor, { action: "auth.mfa.setup-start", resourceType: "app_user", resourceId: user.id });
    });
    return { secret, otpauthUri: totpUri(user.email, secret) };
  }

  async confirmMfaSetup(actor: Actor, code: string): Promise<void> {
    const user = await this.getUser(actor.userId);
    if (!user.mfaPendingSecretEncrypted) throw new BusinessRuleError("Start MFA setup first", "mfa_setup_not_started");
    const pending = user.mfaPendingSecretEncrypted;
    if (!verifyTotp(decryptSecret(pending, this.config.MFA_ENCRYPTION_KEY), code)) {
      throw new BusinessRuleError("Invalid verification code", "invalid_mfa_code");
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(appUser)
        .set({
          mfaEnabled: true,
          mfaSecretEncrypted: pending,
          mfaPendingSecretEncrypted: null,
          updatedAt: new Date(),
          version: sql`${appUser.version} + 1`,
        })
        .where(eq(appUser.id, user.id));
      await this.audit.record(tx, actor, { action: "auth.mfa.enable", resourceType: "app_user", resourceId: user.id });
    });
  }

  async disableMfa(actor: Actor, password: string, code: string): Promise<void> {
    const user = await this.getUser(actor.userId);
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) throw new BusinessRuleError("Multi-factor authentication is not enabled", "mfa_not_enabled");
    const validPassword = await verifyPassword(user.passwordHash, password);
    const validCode = verifyTotp(decryptSecret(user.mfaSecretEncrypted, this.config.MFA_ENCRYPTION_KEY), code);
    if (!validPassword || !validCode) {
      await this.audit.recordStandalone(actor, {
        action: "auth.mfa.disable",
        resourceType: "app_user",
        resourceId: user.id,
        outcome: "failure",
        reason: "invalid_credentials",
      });
      throw new BusinessRuleError("Password or verification code is incorrect", "invalid_credentials");
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(appUser)
        .set({ mfaEnabled: false, mfaSecretEncrypted: null, updatedAt: new Date(), version: sql`${appUser.version} + 1` })
        .where(eq(appUser.id, user.id));
      await this.audit.record(tx, actor, { action: "auth.mfa.disable", resourceType: "app_user", resourceId: user.id });
    });
  }

  async getUser(userId: string): Promise<AppUserRecord> {
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, userId));
    if (!user) throw new UnauthenticatedError();
    return user;
  }

  async hasActiveMembership(userId: string, organizationId: string): Promise<boolean> {
    const rows = await this.activeMemberships(this.db, userId);
    return rows.some((row) => row.id === organizationId);
  }

  private activeMemberships(executor: DbExecutor, userId: string) {
    return executor
      .select({ id: organization.id, code: organization.code, name: organization.name })
      .from(organizationMembership)
      .innerJoin(organization, eq(organization.id, organizationMembership.organizationId))
      .where(and(eq(organizationMembership.userId, userId), eq(organizationMembership.status, "active"), eq(organization.status, "active")));
  }

  private async selectOrganization(userId: string, requested: string | undefined, context: AnonymousAuditContext): Promise<string> {
    const memberships = await this.activeMemberships(this.db, userId);
    if (requested) {
      if (memberships.some((m) => m.id === requested)) return requested;
      await this.audit.recordStandalone(context, {
        action: "auth.login",
        resourceType: "app_user",
        resourceId: userId,
        outcome: "denied",
        reason: "not_a_member",
        metadata: { organizationId: requested },
      });
      throw new ForbiddenError("You are not a member of that organization");
    }
    const [only, ...others] = memberships;
    if (!only) {
      await this.audit.recordStandalone(context, {
        action: "auth.login",
        resourceType: "app_user",
        resourceId: userId,
        outcome: "denied",
        reason: "no_active_membership",
      });
      throw new ForbiddenError("Your account has no active organization access");
    }
    if (others.length > 0) {
      throw new ConflictError("Choose an organization to sign in to", { organizations: memberships }, "organization_selection_required");
    }
    return only.id;
  }

  private async recordFailedAttempt(user: AppUserRecord, context: AnonymousAuditContext, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Increment atomically so concurrent attempts cannot bypass the limit.
      const [updated] = await tx
        .update(appUser)
        .set({ failedLoginCount: sql`${appUser.failedLoginCount} + 1` })
        .where(eq(appUser.id, user.id))
        .returning({ failedLoginCount: appUser.failedLoginCount });
      const locked = (updated?.failedLoginCount ?? 0) >= MAX_FAILED_LOGINS;
      if (locked) {
        await tx
          .update(appUser)
          .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) })
          .where(eq(appUser.id, user.id));
      }
      await this.audit.record(tx, context, {
        action: "auth.login",
        resourceType: "app_user",
        resourceId: user.id,
        outcome: "failure",
        reason,
        metadata: locked ? { lockedForMinutes: LOCKOUT_MINUTES } : undefined,
      });
    });
  }

  private async completeLogin(user: AppUserRecord, organizationId: string, request: RequestMetadata, method: string): Promise<TokenResponse> {
    const { session, refreshToken } = await this.db.transaction(async (tx) => {
      const issued = await this.sessions.create(tx, user.id, organizationId, request);
      await tx.update(appUser).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(appUser.id, user.id));
      await this.audit.record(
        tx,
        { kind: "anonymous", authenticated: true, userId: user.id, organizationId, request },
        {
          action: "auth.login",
          resourceType: "auth_session",
          resourceId: issued.session.id,
          metadata: { method },
        },
      );
      return issued;
    });
    return this.tokenResponse(user.id, session.id, organizationId, refreshToken, session.expiresAt);
  }

  private async tokenResponse(userId: string, sessionId: string, organizationId: string, refreshToken: string, refreshExpiresAt: Date): Promise<TokenResponse> {
    return {
      status: "authenticated",
      accessToken: await this.tokens.signAccessToken({ sub: userId, sid: sessionId, org: organizationId }),
      tokenType: "Bearer",
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      organizationId,
    };
  }
}
