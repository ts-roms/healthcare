import { Inject, Injectable } from "@nestjs/common";
import { type AuditActor, AuditService, type PatientAuditContext } from "@healthcare/audit";
import { burnPasswordVerification, hashPassword, LOCKOUT_MINUTES, MAX_FAILED_LOGINS, verifyPassword } from "@healthcare/auth";
import {
  type Actor,
  APP_CONFIG,
  type AppConfig,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  ForbiddenError,
  NotFoundError,
  randomToken,
  type RequestMetadata,
  sha256Hex,
  UnauthenticatedError,
} from "@healthcare/core";
import { organization } from "@healthcare/organization";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { patient, patientConsent } from "../patient.schema";
import { displayName } from "../patient.views";
import { ACTIVATION_TTL_HOURS, generateActivationCode, hashActivationCode, MAX_ACTIVATION_ATTEMPTS } from "./activation-code";
import type { PortalTokenResponse, portalActivateSchema, portalLoginSchema } from "./portal.dto";
import { patientPortalAccount, type PatientPortalAccountRecord, patientPortalSession } from "./portal.schema";
import { PortalTokenService } from "./portal-tokens";

/** The authenticated patient on a portal request. */
export interface PortalPrincipal {
  accountId: string;
  patientId: string;
  organizationId: string;
  sessionId: string;
  request: RequestMetadata;
}

export interface PortalAccountStatusView {
  status: "none" | "invited" | "active" | "disabled";
  email: string | null;
  invitedAt: string | null;
  activationExpiresAt: string | null;
  /** An invitation whose code can no longer be used (expired or attempts exhausted); a new code is needed. */
  invitationExpired: boolean;
  activatedAt: string | null;
  lastLoginAt: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  portalConsent: boolean;
}

const INVALID_ACTIVATION = "Activation details are incorrect, or the code has expired. Ask the clinic for a new code.";

/**
 * Patient portal accounts (CLAUDE.md §17). Patients are not staff users:
 * separate accounts, sessions and token audience. Portal access requires a
 * current `portal_access` consent — checked at invitation, activation, login
 * and every refresh, so withdrawing consent ends portal access.
 */
@Injectable()
export class PortalAccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tokens: PortalTokenService,
    private readonly audit: AuditService,
  ) {}

  // ---- staff side ------------------------------------------------------------------

  async status(actor: Actor, patientId: string): Promise<PortalAccountStatusView> {
    await this.requirePatient(this.db, actor.organizationId, patientId);
    const [account] = await this.db
      .select()
      .from(patientPortalAccount)
      .where(and(eq(patientPortalAccount.organizationId, actor.organizationId), eq(patientPortalAccount.patientId, patientId)));
    const portalConsent = await this.hasPortalConsent(this.db, actor.organizationId, patientId);
    const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
    return {
      status: account?.status ?? "none",
      email: account?.email ?? null,
      invitedAt: iso(account?.invitedAt),
      activationExpiresAt: account?.status === "invited" ? iso(account.activationExpiresAt) : null,
      invitationExpired: account?.status === "invited" && (!account.activationExpiresAt || account.activationExpiresAt <= new Date()),
      activatedAt: iso(account?.activatedAt),
      lastLoginAt: iso(account?.lastLoginAt),
      disabledAt: iso(account?.disabledAt),
      disabledReason: account?.disabledReason ?? null,
      portalConsent,
    };
  }

  /**
   * Issues a one-time activation code (returned once, stored hashed). Staff hand
   * it to the patient after verifying identity in person. Re-inviting replaces
   * any previous code; an active account must be disabled first.
   */
  async invite(actor: Actor, patientId: string): Promise<{ activationCode: string; expiresAt: string }> {
    return this.db.transaction(async (tx) => {
      const p = await this.requirePatient(tx, actor.organizationId, patientId);
      if (p.status !== "active") throw new BusinessRuleError(`A ${p.status} patient cannot be invited to the portal`, "patient_not_active");
      if (!(await this.hasPortalConsent(tx, actor.organizationId, patientId))) {
        throw new BusinessRuleError("Record the patient's portal access consent before inviting them", "portal_consent_required");
      }
      const [existing] = await tx
        .select()
        .from(patientPortalAccount)
        .where(and(eq(patientPortalAccount.organizationId, actor.organizationId), eq(patientPortalAccount.patientId, patientId)))
        .for("update");
      if (existing?.status === "active") {
        throw new ConflictError("This patient already has an active portal account", undefined, "portal_account_active");
      }
      const code = generateActivationCode();
      const expiresAt = new Date(Date.now() + ACTIVATION_TTL_HOURS * 3600_000);
      const invitation = {
        status: "invited" as const,
        activationCodeHash: hashActivationCode(code),
        activationExpiresAt: expiresAt,
        failedAttempts: 0,
        lockedUntil: null,
        invitedBy: actor.userId,
        invitedAt: new Date(),
        disabledAt: null,
        disabledBy: null,
        disabledReason: null,
      };
      if (existing) {
        await tx
          .update(patientPortalAccount)
          .set({ ...invitation, updatedAt: new Date(), version: sql`${patientPortalAccount.version} + 1` })
          .where(eq(patientPortalAccount.id, existing.id));
      } else {
        await tx.insert(patientPortalAccount).values({ organizationId: actor.organizationId, patientId, ...invitation });
      }
      await this.audit.record(tx, actor, {
        action: "patient.portal-invite",
        resourceType: "patient_portal_account",
        patientId,
        metadata: { expiresAt: expiresAt.toISOString(), reinvite: Boolean(existing) },
      });
      return { activationCode: code, expiresAt: expiresAt.toISOString() };
    });
  }

  async disable(actor: Actor, patientId: string, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(patientPortalAccount)
        .where(and(eq(patientPortalAccount.organizationId, actor.organizationId), eq(patientPortalAccount.patientId, patientId)))
        .for("update");
      if (!account) throw new NotFoundError("Portal account");
      if (account.status === "disabled") return;
      await tx
        .update(patientPortalAccount)
        .set({
          status: "disabled",
          disabledAt: new Date(),
          disabledBy: actor.userId,
          disabledReason: reason,
          activationCodeHash: null,
          activationExpiresAt: null,
          updatedAt: new Date(),
          version: sql`${patientPortalAccount.version} + 1`,
        })
        .where(eq(patientPortalAccount.id, account.id));
      await this.revokeAll(tx, account.id, "account_disabled");
      await this.audit.record(tx, actor, {
        action: "patient.portal-disable",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId,
        reason,
      });
    });
  }

  // ---- patient side -----------------------------------------------------------------

  /** First sign-in: patient number + birth date + activation code, then the patient's own email and password. */
  async activate(input: z.infer<typeof portalActivateSchema>, request: RequestMetadata): Promise<PortalTokenResponse> {
    const org = await this.organizationByCode(input.organizationCode);
    const anonymous = { kind: "anonymous" as const, organizationId: org?.id, request };
    const [row] = org
      ? await this.db
          .select({ account: patientPortalAccount, birthDate: patient.birthDate })
          .from(patientPortalAccount)
          .innerJoin(patient, and(eq(patient.organizationId, patientPortalAccount.organizationId), eq(patient.id, patientPortalAccount.patientId)))
          .where(and(eq(patientPortalAccount.organizationId, org.id), eq(patient.patientNumber, input.patientNumber)))
      : [];
    const account = row?.account;
    if (!org || !account || account.status !== "invited" || !account.activationCodeHash || !account.activationExpiresAt) {
      await this.audit.recordStandalone(anonymous, {
        action: "portal.activate",
        resourceType: "patient_portal_account",
        outcome: "failure",
        reason: "no_invitation",
      });
      throw new UnauthenticatedError(INVALID_ACTIVATION, "invalid_activation");
    }
    const failed = async (reason: "expired" | "mismatch") => {
      // An expired (or exhausted) code is already unusable: don't count further attempts against it.
      const attempts = reason === "mismatch" ? account.failedAttempts + 1 : account.failedAttempts;
      const exhausted = reason === "mismatch" && attempts >= MAX_ACTIVATION_ATTEMPTS;
      if (reason === "mismatch") {
        await this.db
          .update(patientPortalAccount)
          // Exhausted: expire the code (the row stays "invited" until staff re-invite).
          .set(exhausted ? { failedAttempts: attempts, activationExpiresAt: new Date() } : { failedAttempts: attempts })
          .where(and(eq(patientPortalAccount.id, account.id), eq(patientPortalAccount.status, "invited")));
      }
      await this.audit.recordStandalone(anonymous, {
        action: "portal.activate",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId: account.patientId,
        outcome: "failure",
        reason: exhausted ? "attempts_exhausted" : reason,
      });
      throw new UnauthenticatedError(INVALID_ACTIVATION, "invalid_activation");
    };
    if (account.activationExpiresAt <= new Date()) return failed("expired");
    if (row.birthDate !== input.birthDate || hashActivationCode(input.activationCode) !== account.activationCodeHash) return failed("mismatch");

    return this.db.transaction(async (tx) => {
      if (!(await this.hasPortalConsent(tx, org.id, account.patientId))) {
        throw new ForbiddenError("Portal access is not currently authorized. Please contact the clinic.");
      }
      const [emailTaken] = await tx
        .select({ id: patientPortalAccount.id })
        .from(patientPortalAccount)
        .where(and(eq(patientPortalAccount.organizationId, org.id), eq(patientPortalAccount.email, input.email)));
      if (emailTaken && emailTaken.id !== account.id) {
        throw new ConflictError("This email is already used for another portal account", undefined, "email_in_use");
      }
      // Guarded by status so two concurrent activations cannot both succeed.
      const [activated] = await tx
        .update(patientPortalAccount)
        .set({
          status: "active",
          email: input.email,
          passwordHash: await hashPassword(input.password),
          activationCodeHash: null,
          activationExpiresAt: null,
          failedAttempts: 0,
          activatedAt: new Date(),
          lastLoginAt: new Date(),
          updatedAt: new Date(),
          version: sql`${patientPortalAccount.version} + 1`,
        })
        .where(and(eq(patientPortalAccount.id, account.id), eq(patientPortalAccount.status, "invited")))
        .returning();
      if (!activated) throw new UnauthenticatedError(INVALID_ACTIVATION, "invalid_activation");
      const tokens = await this.startSession(tx, activated, request);
      await this.audit.record(tx, this.patientContext(activated, request), {
        action: "portal.activate",
        resourceType: "patient_portal_account",
        resourceId: activated.id,
      });
      return tokens;
    });
  }

  async login(input: z.infer<typeof portalLoginSchema>, request: RequestMetadata): Promise<PortalTokenResponse> {
    const org = await this.organizationByCode(input.organizationCode);
    const [account] = org
      ? await this.db
          .select()
          .from(patientPortalAccount)
          .where(and(eq(patientPortalAccount.organizationId, org.id), eq(patientPortalAccount.email, input.email)))
      : [];
    const anonymous = { kind: "anonymous" as const, organizationId: org?.id, request };
    if (!org || !account || account.status !== "active" || !account.passwordHash) {
      await burnPasswordVerification(input.password);
      await this.audit.recordStandalone(anonymous, {
        action: "portal.login",
        resourceType: "patient_portal_account",
        outcome: "failure",
        reason: "unknown_account",
      });
      throw new UnauthenticatedError("Invalid email or password", "invalid_credentials");
    }
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      await this.audit.recordStandalone(anonymous, {
        action: "portal.login",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId: account.patientId,
        outcome: "denied",
        reason: "locked",
      });
      throw new UnauthenticatedError("Too many failed attempts. Try again later.", "account_locked");
    }
    if (!(await verifyPassword(account.passwordHash, input.password))) {
      await this.recordFailedLogin(account, anonymous);
      throw new UnauthenticatedError("Invalid email or password", "invalid_credentials");
    }
    if (!(await this.hasPortalConsent(this.db, account.organizationId, account.patientId))) {
      await this.audit.recordStandalone(this.patientContext(account, request), {
        action: "portal.login",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        outcome: "denied",
        reason: "portal_consent_withdrawn",
      });
      throw new ForbiddenError("Portal access is not currently authorized. Please contact the clinic.");
    }
    return this.db.transaction(async (tx) => {
      await tx
        .update(patientPortalAccount)
        .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(patientPortalAccount.id, account.id));
      const tokens = await this.startSession(tx, account, request);
      await this.audit.record(tx, this.patientContext(account, request), {
        action: "portal.login",
        resourceType: "patient_portal_account",
        resourceId: account.id,
      });
      return tokens;
    });
  }

  /**
   * Rotates the refresh token. Reusing an already-rotated token revokes the
   * session (theft detection). Revocations are committed before the caller is
   * rejected — throwing inside the transaction would roll them back.
   */
  async refresh(refreshToken: string, request: RequestMetadata): Promise<PortalTokenResponse> {
    const hash = sha256Hex(refreshToken);
    const outcome = await this.db.transaction(async (tx): Promise<{ kind: "rotated"; tokens: PortalTokenResponse } | { kind: "rejected"; message: string }> => {
      const [current] = await tx.select().from(patientPortalSession).where(eq(patientPortalSession.refreshTokenHash, hash)).for("update");
      if (!current) {
        const [reused] = await tx
          .select()
          .from(patientPortalSession)
          .where(and(eq(patientPortalSession.previousRefreshTokenHash, hash), isNull(patientPortalSession.revokedAt)))
          .for("update");
        if (reused) {
          await tx
            .update(patientPortalSession)
            .set({ revokedAt: new Date(), revokedReason: "refresh_token_reuse" })
            .where(eq(patientPortalSession.id, reused.id));
          await this.audit.record(
            tx,
            { kind: "anonymous", organizationId: reused.organizationId, request },
            {
              action: "portal.session-revoke",
              resourceType: "patient_portal_session",
              resourceId: reused.id,
              outcome: "denied",
              reason: "refresh_token_reuse",
            },
          );
        }
        return { kind: "rejected", message: "Invalid or expired token" };
      }
      if (current.revokedAt || current.expiresAt <= new Date()) return { kind: "rejected", message: "Invalid or expired token" };
      const account = await this.activeAccount(tx, current.organizationId, current.accountId);
      if (!account || !(await this.hasPortalConsent(tx, account.organizationId, account.patientId))) {
        await tx
          .update(patientPortalSession)
          .set({ revokedAt: new Date(), revokedReason: account ? "portal_consent_withdrawn" : "account_inactive" })
          .where(eq(patientPortalSession.id, current.id));
        return { kind: "rejected", message: "Portal access has ended" };
      }
      const next = randomToken();
      await tx
        .update(patientPortalSession)
        .set({ refreshTokenHash: sha256Hex(next), previousRefreshTokenHash: hash, lastUsedAt: new Date() })
        .where(eq(patientPortalSession.id, current.id));
      return { kind: "rotated", tokens: await this.tokenResponse(account, current.id, next, current.expiresAt) };
    });
    if (outcome.kind === "rejected") throw new UnauthenticatedError(outcome.message, "invalid_token");
    return outcome.tokens;
  }

  async logout(principal: PortalPrincipal): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(patientPortalSession)
        .set({ revokedAt: new Date(), revokedReason: "logout" })
        .where(and(eq(patientPortalSession.id, principal.sessionId), isNull(patientPortalSession.revokedAt)));
      await this.audit.record(tx, this.principalContext(principal), {
        action: "portal.logout",
        resourceType: "patient_portal_session",
        resourceId: principal.sessionId,
      });
    });
  }

  /**
   * Resolves a portal access token to a principal. The session and account are
   * checked on every request, so logout, disabling and consent withdrawal take
   * effect immediately rather than at token expiry.
   */
  async authenticate(token: string, request: RequestMetadata): Promise<PortalPrincipal> {
    const claims = await this.tokens.verify(token);
    const [row] = await this.db
      .select({ session: patientPortalSession, account: patientPortalAccount })
      .from(patientPortalSession)
      .innerJoin(
        patientPortalAccount,
        and(eq(patientPortalAccount.organizationId, patientPortalSession.organizationId), eq(patientPortalAccount.id, patientPortalSession.accountId)),
      )
      .where(
        and(
          eq(patientPortalSession.id, claims.sid),
          eq(patientPortalSession.accountId, claims.sub),
          isNull(patientPortalSession.revokedAt),
          gt(patientPortalSession.expiresAt, new Date()),
        ),
      );
    if (!row || row.account.status !== "active" || row.account.organizationId !== claims.org || row.account.patientId !== claims.pat) {
      throw new UnauthenticatedError("Your session has ended. Sign in again.", "session_ended");
    }
    if (!(await this.hasPortalConsent(this.db, row.account.organizationId, row.account.patientId))) {
      throw new UnauthenticatedError("Portal access has ended", "session_ended");
    }
    return { accountId: row.account.id, patientId: row.account.patientId, organizationId: row.account.organizationId, sessionId: row.session.id, request };
  }

  /** Whether the patient can sign in to the portal now (active account and portal consent). For notifications; not audited. */
  async canUsePortal(organizationId: string, patientId: string): Promise<boolean> {
    const [account] = await this.db
      .select({ status: patientPortalAccount.status })
      .from(patientPortalAccount)
      .where(and(eq(patientPortalAccount.organizationId, organizationId), eq(patientPortalAccount.patientId, patientId)));
    if (account?.status !== "active") return false;
    return this.hasPortalConsent(this.db, organizationId, patientId);
  }

  /** The signed-in patient's own profile (identity only; clinical records come from the portal records endpoints). */
  async me(principal: PortalPrincipal) {
    const [row] = await this.db
      .select({ patient, organizationName: organization.name, email: patientPortalAccount.email })
      .from(patient)
      .innerJoin(organization, eq(organization.id, patient.organizationId))
      .innerJoin(patientPortalAccount, eq(patientPortalAccount.id, principal.accountId))
      .where(and(eq(patient.organizationId, principal.organizationId), eq(patient.id, principal.patientId)));
    if (!row) throw new NotFoundError("Patient");
    await this.audit.recordStandalone(this.principalContext(principal), {
      action: "portal.profile-view",
      resourceType: "patient",
      resourceId: principal.patientId,
    });
    return {
      patient: {
        displayName: displayName(row.patient),
        givenName: row.patient.givenName,
        familyName: row.patient.familyName,
        patientNumber: row.patient.patientNumber,
        birthDate: row.patient.birthDate,
        sex: row.patient.sex,
      },
      organization: { name: row.organizationName },
      account: { email: row.email },
    };
  }

  // ---- internals -----------------------------------------------------------------------

  private async requirePatient(executor: DbExecutor, organizationId: string, patientId: string) {
    const [p] = await executor
      .select({ id: patient.id, status: patient.status })
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    if (!p) throw new NotFoundError("Patient");
    return p;
  }

  /** The latest portal_access decision is "granted" and currently in effect (consents are append-only). */
  private async hasPortalConsent(executor: DbExecutor, organizationId: string, patientId: string): Promise<boolean> {
    const [latest] = await executor
      .select()
      .from(patientConsent)
      .where(and(eq(patientConsent.organizationId, organizationId), eq(patientConsent.patientId, patientId), eq(patientConsent.consentType, "portal_access")))
      .orderBy(desc(patientConsent.recordedAt))
      .limit(1);
    const now = new Date();
    return Boolean(latest && latest.decision === "granted" && latest.effectiveAt <= now && (!latest.expiresAt || latest.expiresAt > now));
  }

  private async organizationByCode(code: string) {
    const [org] = await this.db.select({ id: organization.id, status: organization.status }).from(organization).where(eq(organization.code, code));
    return org && org.status === "active" ? org : undefined;
  }

  private async activeAccount(executor: DbExecutor, organizationId: string, accountId: string) {
    const [account] = await executor
      .select()
      .from(patientPortalAccount)
      .where(and(eq(patientPortalAccount.organizationId, organizationId), eq(patientPortalAccount.id, accountId), eq(patientPortalAccount.status, "active")));
    return account;
  }

  private async recordFailedLogin(account: PatientPortalAccountRecord, context: AuditActor): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Atomic increment so concurrent attempts cannot bypass the limit.
      const [updated] = await tx
        .update(patientPortalAccount)
        .set({ failedAttempts: sql`${patientPortalAccount.failedAttempts} + 1` })
        .where(eq(patientPortalAccount.id, account.id))
        .returning({ failedAttempts: patientPortalAccount.failedAttempts });
      const locked = (updated?.failedAttempts ?? 0) >= MAX_FAILED_LOGINS;
      if (locked) {
        await tx
          .update(patientPortalAccount)
          .set({ failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) })
          .where(eq(patientPortalAccount.id, account.id));
      }
      await this.audit.record(tx, context, {
        action: "portal.login",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId: account.patientId,
        outcome: "failure",
        reason: locked ? "invalid_password_locked" : "invalid_password",
      });
    });
  }

  private async startSession(executor: DbExecutor, account: PatientPortalAccountRecord, request: RequestMetadata): Promise<PortalTokenResponse> {
    const refreshToken = randomToken();
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const [session] = await executor
      .insert(patientPortalSession)
      .values({
        organizationId: account.organizationId,
        accountId: account.id,
        refreshTokenHash: sha256Hex(refreshToken),
        expiresAt,
        ipAddress: request.ipAddress ?? null,
        userAgent: request.userAgent?.slice(0, 512) ?? null,
      })
      .returning();
    return this.tokenResponse(account, session!.id, refreshToken, expiresAt);
  }

  private async tokenResponse(account: PatientPortalAccountRecord, sessionId: string, refreshToken: string, expiresAt: Date): Promise<PortalTokenResponse> {
    return {
      status: "authenticated",
      accessToken: await this.tokens.sign({ sub: account.id, sid: sessionId, org: account.organizationId, pat: account.patientId }),
      tokenType: "Bearer",
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  private async revokeAll(executor: DbExecutor, accountId: string, reason: string): Promise<void> {
    await executor
      .update(patientPortalSession)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(patientPortalSession.accountId, accountId), isNull(patientPortalSession.revokedAt)));
  }

  private patientContext(account: PatientPortalAccountRecord, request: RequestMetadata): PatientAuditContext {
    return { kind: "patient", accountId: account.id, patientId: account.patientId, organizationId: account.organizationId, request };
  }

  private principalContext(p: PortalPrincipal): PatientAuditContext {
    return patientAuditContext(p);
  }
}

/** Audit context for something a signed-in patient does (actor type "patient"). */
export function patientAuditContext(p: PortalPrincipal): PatientAuditContext {
  return { kind: "patient", accountId: p.accountId, patientId: p.patientId, organizationId: p.organizationId, request: p.request };
}
