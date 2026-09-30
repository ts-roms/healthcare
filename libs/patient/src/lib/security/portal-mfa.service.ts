import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { generateTotpSecret, totpUri, verifyTotpStep } from "@healthcare/auth";
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
  NotFoundError,
  type RequestMetadata,
  UnauthenticatedError,
} from "@healthcare/core";
import { organization } from "@healthcare/organization";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { PortalTokenResponse } from "../portal/portal.dto";
import { type PatientPortalAccountRecord, patientPortalAccount, patientPortalRecoveryCode } from "../portal/portal.schema";
import { PortalAccountService, type PortalPrincipal } from "../portal/portal-account.service";
import { PortalSecurityMailers, type SecurityAlertEvent } from "../portal/portal-security-mailer";
import { PortalTokenService } from "../portal/portal-tokens";
import { generateRecoveryCode, groupSetupKey, hashRecoveryCode, RECOVERY_CODE_COUNT, type SecondFactorKind, secondFactorKind } from "./portal-security.rules";

export interface PortalMfaStatusView {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  emailVerified: boolean;
}

/** The second step's result: which kind worked, and for a recovery code how many are left. */
type SecondFactorResult = { ok: true; kind: SecondFactorKind; recoveryCodesLeft?: number } | { ok: false };

const WRONG_CODE = "That code is not correct. Try the newest code in your authenticator app, or a recovery code.";

/**
 * Two-step verification for MyHealth (docs/architecture/portal-app.md, "Two-step verification"): an authenticator app
 * (TOTP, RFC 6238) after the password, with single-use recovery codes.
 *
 * - Needs a verified sign-in email, so the notices about it reach a confirmed mailbox.
 * - A code works once: the last accepted time step is kept, and an older or repeated one is refused.
 * - Wrong codes count toward the same lockout as wrong passwords.
 * - The secret is sealed with MFA_ENCRYPTION_KEY; recovery codes are stored as hashes and shown once.
 * - A patient who lost both the app and the codes is helped at the clinic, which turns it off after checking identity;
 *   that ends every session and is audited.
 */
@Injectable()
export class PortalMfaService {
  private readonly logger = new Logger(PortalMfaService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly accounts: PortalAccountService,
    private readonly tokens: PortalTokenService,
    private readonly mailer: PortalSecurityMailers,
    private readonly audit: AuditService,
  ) {}

  async status(principal: PortalPrincipal): Promise<PortalMfaStatusView> {
    const account = await this.accounts.accountOf(principal);
    return {
      enabled: account.mfaEnabled,
      enabledAt: account.mfaEnabledAt?.toISOString() ?? null,
      recoveryCodesRemaining: account.mfaEnabled ? await this.remainingRecoveryCodes(this.db, account.id) : 0,
      emailVerified: Boolean(account.emailVerifiedAt),
    };
  }

  /** Step 1: a new secret, pending until the patient proves their app shows the right codes. */
  async begin(principal: PortalPrincipal, password: string): Promise<{ setupKey: string; secret: string; otpauthUri: string }> {
    const account = await this.accounts.confirmPassword(principal, password);
    if (account.mfaEnabled) throw new ConflictError("Two-step verification is already on", undefined, "mfa_already_enabled");
    if (!account.emailVerifiedAt) {
      throw new BusinessRuleError("Verify your email address first: notices about two-step verification are sent to it", "email_not_verified");
    }
    const secret = generateTotpSecret();
    const [org] = await this.db.select({ name: organization.name }).from(organization).where(eq(organization.id, account.organizationId));
    await this.db.transaction(async (tx) => {
      await tx
        .update(patientPortalAccount)
        .set({ mfaPendingSecretEncrypted: encryptSecret(secret, this.config.MFA_ENCRYPTION_KEY), updatedAt: new Date() })
        .where(eq(patientPortalAccount.id, account.id));
      await this.audit.record(tx, this.accounts.principalContext(principal), {
        action: "portal.mfa-setup-start",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId: account.patientId,
      });
    });
    return { setupKey: groupSetupKey(secret), secret, otpauthUri: totpUri(account.email ?? "", secret, org?.name ?? "MyHealth") };
  }

  /** Step 2: the patient types the code their app shows; two-step verification turns on and the recovery codes are shown once. */
  async enable(principal: PortalPrincipal, code: string): Promise<{ recoveryCodes: string[] }> {
    const outcome = await this.db.transaction(
      async (tx): Promise<{ kind: "ok"; codes: string[]; account: PatientPortalAccountRecord } | { kind: "bad" } | { kind: "not_started" }> => {
        const account = await this.lockedAccount(tx, principal);
        if (account.mfaEnabled) throw new ConflictError("Two-step verification is already on", undefined, "mfa_already_enabled");
        if (!account.emailVerifiedAt) throw new BusinessRuleError("Verify your email address first", "email_not_verified");
        if (!account.mfaPendingSecretEncrypted) return { kind: "not_started" };
        const secret = decryptSecret(account.mfaPendingSecretEncrypted, this.config.MFA_ENCRYPTION_KEY);
        const step = verifyTotpStep(secret, code.replace(/\s+/g, ""));
        if (step === null) return { kind: "bad" };
        const now = new Date();
        await tx
          .update(patientPortalAccount)
          .set({
            mfaEnabled: true,
            mfaSecretEncrypted: account.mfaPendingSecretEncrypted,
            mfaPendingSecretEncrypted: null,
            mfaEnabledAt: now,
            mfaLastUsedStep: step,
            updatedAt: now,
            version: sql`${patientPortalAccount.version} + 1`,
          })
          .where(eq(patientPortalAccount.id, account.id));
        const codes = await this.replaceRecoveryCodes(tx, account);
        await this.audit.record(tx, this.accounts.principalContext(principal), {
          action: "portal.mfa-enable",
          resourceType: "patient_portal_account",
          resourceId: account.id,
          patientId: account.patientId,
        });
        return { kind: "ok", codes, account };
      },
    );
    if (outcome.kind === "not_started") throw new BusinessRuleError("Start setup first", "mfa_setup_not_started");
    if (outcome.kind === "bad") throw new BusinessRuleError(WRONG_CODE, "invalid_mfa_code");
    await this.alert(outcome.account, "mfa_enabled");
    return { recoveryCodes: outcome.codes };
  }

  /** Turns it off: needs the password and a current code (the app's, or a recovery code). */
  async disable(principal: PortalPrincipal, input: { password: string; code: string }): Promise<void> {
    const account = await this.accounts.confirmPassword(principal, input.password);
    if (!account.mfaEnabled) throw new BusinessRuleError("Two-step verification is not on", "mfa_not_enabled");
    await this.requireSecondFactor(principal, input.code, true);
    await this.db.transaction(async (tx) => {
      await this.clearMfa(tx, account.id);
      await this.audit.record(tx, this.accounts.principalContext(principal), {
        action: "portal.mfa-disable",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId: account.patientId,
      });
    });
    await this.alert(account, "mfa_disabled");
  }

  /** Makes a new set of recovery codes; the old ones stop working. Needs the password and a current app code. */
  async renewRecoveryCodes(principal: PortalPrincipal, input: { password: string; code: string }): Promise<{ recoveryCodes: string[] }> {
    const account = await this.accounts.confirmPassword(principal, input.password);
    if (!account.mfaEnabled) throw new BusinessRuleError("Two-step verification is not on", "mfa_not_enabled");
    await this.requireSecondFactor(principal, input.code, false);
    const codes = await this.db.transaction(async (tx) => {
      const made = await this.replaceRecoveryCodes(tx, account);
      await this.audit.record(tx, this.accounts.principalContext(principal), {
        action: "portal.mfa-recovery-codes",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        patientId: account.patientId,
      });
      return made;
    });
    await this.alert(account, "recovery_codes_renewed");
    return { recoveryCodes: codes };
  }

  /** The second step of signing in: the challenge from the password step plus the app's code or a recovery code. */
  async verifyLogin(challengeToken: string, code: string, request: RequestMetadata): Promise<PortalTokenResponse> {
    const claims = await this.tokens.verifyMfaChallenge(challengeToken);
    const [account] = await this.db
      .select()
      .from(patientPortalAccount)
      .where(and(eq(patientPortalAccount.organizationId, claims.org), eq(patientPortalAccount.id, claims.sub), eq(patientPortalAccount.status, "active")));
    if (!account || !account.mfaEnabled || !account.mfaSecretEncrypted) throw new UnauthenticatedError("Invalid or expired token", "invalid_token");
    const context = this.accounts.patientContext(account, request);
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      await this.audit.recordStandalone(context, {
        action: "portal.login",
        resourceType: "patient_portal_account",
        resourceId: account.id,
        outcome: "denied",
        reason: "locked",
      });
      throw new UnauthenticatedError("Too many failed attempts. Try again later.", "account_locked");
    }
    if (!(await this.accounts.hasPortalConsent(this.db, account.organizationId, account.patientId))) {
      throw new UnauthenticatedError("Portal access has ended", "session_ended");
    }
    // The code is spent and the session opened together; a wrong code is counted after the attempt is rolled back.
    const outcome = await this.db.transaction(
      async (tx): Promise<{ kind: "ok"; tokens: PortalTokenResponse; result: SecondFactorResult & { ok: true } } | { kind: "bad" }> => {
        await tx.select({ id: patientPortalAccount.id }).from(patientPortalAccount).where(eq(patientPortalAccount.id, account.id)).for("update");
        const [fresh] = await tx.select().from(patientPortalAccount).where(eq(patientPortalAccount.id, account.id));
        const result = fresh ? await this.checkSecondFactor(tx, fresh, code, true) : ({ ok: false } as const);
        if (!result.ok) return { kind: "bad" };
        const tokens = await this.accounts.completeLogin(tx, account, request, result.kind === "totp" ? "password+totp" : "password+recovery_code");
        return { kind: "ok", tokens, result };
      },
    );
    if (outcome.kind === "bad") {
      await this.accounts.recordFailedLogin(account, context, "invalid_mfa_code");
      throw new UnauthenticatedError("That code is not correct", "invalid_mfa_code");
    }
    if (outcome.result.kind === "recovery_code") await this.alert(account, "recovery_code_used", String(outcome.result.recoveryCodesLeft ?? 0));
    return outcome.tokens;
  }

  /** The clinic turns two-step verification off for a patient who lost the app and the recovery codes, after checking identity. */
  async resetByClinic(actor: Actor, patientId: string, reason: string): Promise<void> {
    const account = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(patientPortalAccount)
        .where(and(eq(patientPortalAccount.organizationId, actor.organizationId), eq(patientPortalAccount.patientId, patientId)))
        .for("update");
      if (!row) throw new NotFoundError("Portal account");
      if (!row.mfaEnabled) throw new BusinessRuleError("Two-step verification is not on for this patient", "mfa_not_enabled");
      await this.clearMfa(tx, row.id);
      await this.accounts.revokeAll(tx, row.id, "mfa_reset");
      await this.audit.record(tx, actor, {
        action: "patient.portal-mfa-reset",
        resourceType: "patient_portal_account",
        resourceId: row.id,
        patientId,
        reason,
      });
      return row;
    });
    await this.alert(account, "mfa_reset_by_clinic");
  }

  /**
   * A signed-in patient's second step for a sensitive change, spending the code. Wrong codes count toward the lockout.
   * Used by this service and by changing the sign-in email.
   */
  async requireSecondFactor(principal: PortalPrincipal, code: string, allowRecovery: boolean): Promise<SecondFactorResult & { ok: true }> {
    const result = await this.db.transaction(async (tx) => {
      const account = await this.lockedAccount(tx, principal);
      return this.checkSecondFactor(tx, account, code, allowRecovery);
    });
    if (!result.ok) {
      const account = await this.accounts.accountOf(principal);
      await this.accounts.recordFailedLogin(account, this.accounts.principalContext(principal), "invalid_mfa_code");
      throw new BusinessRuleError(WRONG_CODE, "invalid_mfa_code");
    }
    return result;
  }

  // ---- internals ------------------------------------------------------------------------

  private async lockedAccount(tx: DbExecutor, principal: PortalPrincipal): Promise<PatientPortalAccountRecord> {
    const [row] = await tx
      .select()
      .from(patientPortalAccount)
      .where(
        and(
          eq(patientPortalAccount.organizationId, principal.organizationId),
          eq(patientPortalAccount.id, principal.accountId),
          eq(patientPortalAccount.status, "active"),
        ),
      )
      .for("update");
    if (!row) throw new UnauthenticatedError("Your session has ended. Sign in again.", "session_ended");
    return row;
  }

  /** Checks a code against the app or the recovery codes and spends it, in the caller's transaction (the account row is locked). */
  private async checkSecondFactor(tx: DbExecutor, account: PatientPortalAccountRecord, code: string, allowRecovery: boolean): Promise<SecondFactorResult> {
    const kind = secondFactorKind(code);
    if (!kind || !account.mfaSecretEncrypted) return { ok: false };
    if (kind === "totp") {
      const step = verifyTotpStep(decryptSecret(account.mfaSecretEncrypted, this.config.MFA_ENCRYPTION_KEY), code.replace(/\s+/g, ""));
      // A step at or before the last accepted one is a code already used (or older than one used): refused.
      if (step === null || (account.mfaLastUsedStep !== null && step <= account.mfaLastUsedStep)) return { ok: false };
      await tx.update(patientPortalAccount).set({ mfaLastUsedStep: step }).where(eq(patientPortalAccount.id, account.id));
      return { ok: true, kind };
    }
    if (!allowRecovery) return { ok: false };
    const [used] = await tx
      .update(patientPortalRecoveryCode)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(patientPortalRecoveryCode.accountId, account.id),
          eq(patientPortalRecoveryCode.codeHash, hashRecoveryCode(account.id, code)),
          isNull(patientPortalRecoveryCode.usedAt),
        ),
      )
      .returning({ id: patientPortalRecoveryCode.id });
    if (!used) return { ok: false };
    return { ok: true, kind, recoveryCodesLeft: await this.remainingRecoveryCodes(tx, account.id) };
  }

  private async replaceRecoveryCodes(tx: DbExecutor, account: PatientPortalAccountRecord): Promise<string[]> {
    await tx.delete(patientPortalRecoveryCode).where(eq(patientPortalRecoveryCode.accountId, account.id));
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
    await tx
      .insert(patientPortalRecoveryCode)
      .values(codes.map((code) => ({ organizationId: account.organizationId, accountId: account.id, codeHash: hashRecoveryCode(account.id, code) })));
    return codes;
  }

  private async clearMfa(tx: DbExecutor, accountId: string): Promise<void> {
    await tx
      .update(patientPortalAccount)
      .set({
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaPendingSecretEncrypted: null,
        mfaEnabledAt: null,
        mfaLastUsedStep: null,
        updatedAt: new Date(),
        version: sql`${patientPortalAccount.version} + 1`,
      })
      .where(eq(patientPortalAccount.id, accountId));
    await tx.delete(patientPortalRecoveryCode).where(eq(patientPortalRecoveryCode.accountId, accountId));
  }

  private async remainingRecoveryCodes(executor: DbExecutor, accountId: string): Promise<number> {
    const [row] = await executor
      .select({ left: count() })
      .from(patientPortalRecoveryCode)
      .where(and(eq(patientPortalRecoveryCode.accountId, accountId), isNull(patientPortalRecoveryCode.usedAt)));
    return row?.left ?? 0;
  }

  /** A notice to the account's email; a failed send is logged, never the patient's problem. */
  private async alert(account: PatientPortalAccountRecord, event: SecurityAlertEvent, detail?: string): Promise<void> {
    await this.mailer
      .sendSecurityAlert({ organizationId: account.organizationId, patientId: account.patientId, eventId: randomUUID(), event, detail })
      .catch((error: unknown) => this.logger.warn(`Security notice "${event}" was not sent: ${String(error)}`));
  }
}
