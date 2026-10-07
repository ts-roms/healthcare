import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  APP_CONFIG,
  type AppConfig,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  NotFoundError,
  sha256Hex,
  UnauthenticatedError,
} from "@healthcare/core";
import { organization } from "@healthcare/organization";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeClientDataJSON, isoBase64URL, parseAuthenticatorData } from "@simplewebauthn/server/helpers";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import {
  type PasskeyRevokeReason,
  patientPasskey,
  patientPasskeyChallenge,
  patientPortalAccount,
  type PatientPortalAccountRecord,
} from "../portal/portal.schema";
import { PortalAccountService, type PortalPrincipal } from "../portal/portal-account.service";
import { PortalSecurityMailers, type SecurityAlertEvent } from "../portal/portal-security-mailer";
import { PortalTokenService } from "../portal/portal-tokens";
import { deviceLabel, PASSKEY_CHALLENGE_MINUTES, PASSKEY_LIMIT, passkeyCounterRolledBack, passkeyRelyingParty } from "./portal-security.rules";

export interface PasskeyView {
  id: string;
  label: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The outcome of a passkey answering the second step; a refusal names why only for the audit trail. */
export type PasskeyAssertionResult =
  { ok: true; passkeyId: string; label: string } | { ok: false; reason: "challenge" | "unknown" | "counter_rollback" | "invalid" };

/**
 * Passkeys for MyHealth (migration 0108, docs/architecture/portal-app.md, "Passkeys"): a WebAuthn credential that
 * answers the second step of signing in instead of a code. Added only on top of two-step verification with the
 * authenticator app, which stays the fallback; adding one needs the password and a current code. User verification
 * (the phone's PIN, fingerprint or face) is always required. The relying party is MyHealth's own address
 * (PORTAL_BASE_URL); without it every route answers `passkeys_unavailable`.
 */
@Injectable()
export class PortalPasskeyService {
  private readonly logger = new Logger(PortalPasskeyService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly accounts: PortalAccountService,
    private readonly tokens: PortalTokenService,
    private readonly mailer: PortalSecurityMailers,
    private readonly audit: AuditService,
  ) {}

  /** Whether this deployment offers passkeys at all. */
  available(): boolean {
    return passkeyRelyingParty(this.config.PORTAL_BASE_URL) !== null;
  }

  async list(principal: PortalPrincipal): Promise<{ available: boolean; limit: number; passkeys: PasskeyView[] }> {
    const rows = await this.db
      .select()
      .from(patientPasskey)
      .where(
        and(eq(patientPasskey.accountId, principal.accountId), eq(patientPasskey.organizationId, principal.organizationId), isNull(patientPasskey.revokedAt)),
      )
      .orderBy(asc(patientPasskey.createdAt));
    return {
      available: this.available(),
      limit: PASSKEY_LIMIT,
      passkeys: rows.map((r) => ({
        id: r.id,
        label: r.label,
        backedUp: r.backedUp,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Before the password and code are checked: refuses early when a passkey could not be added anyway. */
  async assertCanAdd(principal: PortalPrincipal): Promise<void> {
    this.relyingParty();
    const account = await this.accounts.accountOf(principal);
    if (!account.mfaEnabled) throw new BusinessRuleError("Turn on two-step verification with an authenticator app first", "mfa_not_enabled");
    if ((await this.activeCount(this.db, account.id)) >= PASSKEY_LIMIT) {
      throw new BusinessRuleError(`An account can have at most ${PASSKEY_LIMIT} passkeys. Remove one first.`, "passkey_limit_reached");
    }
  }

  /** Registration options for the browser, after the password and a current code were checked by the caller. */
  async registrationOptions(principal: PortalPrincipal): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const rp = this.relyingParty();
    const account = await this.accounts.accountOf(principal);
    const [org] = await this.db.select({ name: organization.name }).from(organization).where(eq(organization.id, account.organizationId));
    const active = await this.db
      .select({ credentialId: patientPasskey.credentialId, transports: patientPasskey.transports })
      .from(patientPasskey)
      .where(and(eq(patientPasskey.accountId, account.id), isNull(patientPasskey.revokedAt)));
    const challenge = await this.newChallenge(account, "register");
    return generateRegistrationOptions({
      rpName: org?.name ?? "MyHealth",
      rpID: rp.rpID,
      userName: account.email ?? "MyHealth",
      userDisplayName: account.email ?? "MyHealth",
      userID: new TextEncoder().encode(account.id),
      challenge,
      timeout: PASSKEY_CHALLENGE_MINUTES * 60_000,
      attestationType: "none",
      excludeCredentials: active.map((c) => ({ id: c.credentialId, transports: c.transports })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
  }

  /** Stores the passkey the browser made for the latest registration options; the challenge works once. */
  async register(principal: PortalPrincipal, response: RegistrationResponseJSON, label: string | undefined, userAgent: string | null): Promise<PasskeyView> {
    const rp = this.relyingParty();
    const account = await this.accounts.accountOf(principal);
    const challenge = await this.consumeChallenge(this.db, account.id, "register", response.response?.clientDataJSON);
    if (!challenge) throw new BusinessRuleError("The request to add a passkey expired. Start again.", "passkey_challenge_invalid");
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.warn(`A passkey registration did not verify: ${String(error)}`);
      throw new BusinessRuleError("The passkey could not be checked. Try again.", "passkey_not_verified");
    }
    if (!verified.verified) throw new BusinessRuleError("The passkey could not be checked. Try again.", "passkey_not_verified");
    const info = verified.registrationInfo;
    const name = label?.trim() || deviceLabel(userAgent);
    const view = await this.db.transaction(async (tx) => {
      // The account row is locked so two additions at once cannot pass the limit together.
      await tx.select({ id: patientPortalAccount.id }).from(patientPortalAccount).where(eq(patientPortalAccount.id, account.id)).for("update");
      const [existing] = await tx.select({ id: patientPasskey.id }).from(patientPasskey).where(eq(patientPasskey.credentialId, info.credential.id));
      if (existing) throw new BusinessRuleError("This passkey was added already", "passkey_already_added");
      if ((await this.activeCount(tx, account.id)) >= PASSKEY_LIMIT) {
        throw new BusinessRuleError(`An account can have at most ${PASSKEY_LIMIT} passkeys. Remove one first.`, "passkey_limit_reached");
      }
      const [row] = await tx
        .insert(patientPasskey)
        .values({
          organizationId: account.organizationId,
          accountId: account.id,
          credentialId: info.credential.id,
          publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
          signCount: info.credential.counter,
          transports: info.credential.transports ?? [],
          backedUp: info.credentialBackedUp,
          label: name.slice(0, 80),
        })
        .returning();
      await this.audit.record(tx, this.accounts.principalContext(principal), {
        action: "portal.passkey-add",
        resourceType: "patient_passkey",
        resourceId: row!.id,
        patientId: account.patientId,
        metadata: { label: row!.label, backedUp: row!.backedUp },
      });
      return { id: row!.id, label: row!.label, backedUp: row!.backedUp, createdAt: row!.createdAt.toISOString(), lastUsedAt: null };
    });
    await this.alert(account, "passkey_added", view.label);
    return view;
  }

  /** The patient removes one of their passkeys; the app and recovery codes keep working. */
  async remove(principal: PortalPrincipal, passkeyId: string): Promise<void> {
    const account = await this.accounts.accountOf(principal);
    const removed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(patientPasskey)
        .set({ revokedAt: new Date(), revokedReason: "removed_by_patient" })
        .where(and(eq(patientPasskey.id, passkeyId), eq(patientPasskey.accountId, account.id), isNull(patientPasskey.revokedAt)))
        .returning();
      if (!row) throw new NotFoundError("Passkey");
      await this.audit.record(tx, this.accounts.principalContext(principal), {
        action: "portal.passkey-remove",
        resourceType: "patient_passkey",
        resourceId: row.id,
        patientId: account.patientId,
        metadata: { label: row.label },
      });
      return row;
    });
    await this.alert(account, "passkey_removed", removed.label);
  }

  /** Options for the second step of signing in with a passkey; the challenge from the password step is the credential. */
  async signInOptions(challengeToken: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const rp = this.relyingParty();
    const claims = await this.tokens.verifyMfaChallenge(challengeToken);
    const [account] = await this.db
      .select()
      .from(patientPortalAccount)
      .where(and(eq(patientPortalAccount.organizationId, claims.org), eq(patientPortalAccount.id, claims.sub), eq(patientPortalAccount.status, "active")));
    if (!account || !account.mfaEnabled) throw new UnauthenticatedError("Invalid or expired token", "invalid_token");
    const active = await this.db
      .select({ credentialId: patientPasskey.credentialId, transports: patientPasskey.transports })
      .from(patientPasskey)
      .where(and(eq(patientPasskey.accountId, account.id), isNull(patientPasskey.revokedAt)));
    if (active.length === 0) throw new BusinessRuleError("This account has no passkey. Use a code instead.", "no_passkeys");
    const challenge = await this.newChallenge(account, "sign_in");
    return generateAuthenticationOptions({
      rpID: rp.rpID,
      challenge,
      timeout: PASSKEY_CHALLENGE_MINUTES * 60_000,
      userVerification: "required",
      allowCredentials: active.map((c) => ({ id: c.credentialId, transports: c.transports })),
    });
  }

  /**
   * Checks a passkey's answer to the second step, in the caller's transaction (the account row is locked): the
   * challenge is spent whatever the outcome, and on success the counter and last use are recorded.
   */
  async checkAssertion(tx: DbExecutor, account: PatientPortalAccountRecord, response: AuthenticationResponseJSON): Promise<PasskeyAssertionResult> {
    const rp = this.relyingParty();
    const challenge = await this.consumeChallenge(tx, account.id, "sign_in", response.response?.clientDataJSON);
    if (!challenge) return { ok: false, reason: "challenge" };
    const [passkey] = await tx
      .select()
      .from(patientPasskey)
      .where(and(eq(patientPasskey.accountId, account.id), eq(patientPasskey.credentialId, response.id), isNull(patientPasskey.revokedAt)));
    if (!passkey) return { ok: false, reason: "unknown" };
    try {
      const received = parseAuthenticatorData(isoBase64URL.toBuffer(response.response.authenticatorData)).counter;
      if (passkeyCounterRolledBack(passkey.signCount, received)) return { ok: false, reason: "counter_rollback" };
      const verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: isoBase64URL.toBuffer(passkey.publicKey),
          counter: passkey.signCount,
          transports: passkey.transports,
        },
      });
      if (!verified.verified) return { ok: false, reason: "invalid" };
      await tx
        .update(patientPasskey)
        .set({ signCount: verified.authenticationInfo.newCounter, backedUp: verified.authenticationInfo.credentialBackedUp, lastUsedAt: new Date() })
        .where(eq(patientPasskey.id, passkey.id));
      return { ok: true, passkeyId: passkey.id, label: passkey.label };
    } catch (error) {
      this.logger.warn(`A passkey sign-in did not verify: ${String(error)}`);
      return { ok: false, reason: "invalid" };
    }
  }

  /** The passkey a refused answer named, for the audit trail of a counter that went backwards. */
  async recordRefusal(context: PatientAuditContext, account: PatientPortalAccountRecord, credentialId: string, reason: "counter_rollback"): Promise<void> {
    const [passkey] = await this.db
      .select({ id: patientPasskey.id })
      .from(patientPasskey)
      .where(and(eq(patientPasskey.accountId, account.id), eq(patientPasskey.credentialId, credentialId)));
    await this.audit.recordStandalone(context, {
      action: "portal.passkey-refused",
      resourceType: "patient_passkey",
      resourceId: passkey?.id ?? account.id,
      patientId: account.patientId,
      outcome: "denied",
      reason,
    });
  }

  /** Removes every passkey of an account when two-step verification ends, in the caller's transaction. */
  async revokeAll(tx: DbExecutor, accountId: string, reason: Exclude<PasskeyRevokeReason, "removed_by_patient">): Promise<void> {
    await tx
      .update(patientPasskey)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(patientPasskey.accountId, accountId), isNull(patientPasskey.revokedAt)));
  }

  // ---- internals ------------------------------------------------------------------------

  private relyingParty(): { rpID: string; origin: string } {
    const rp = passkeyRelyingParty(this.config.PORTAL_BASE_URL);
    if (!rp) throw new BusinessRuleError("Passkeys are not available on this MyHealth address", "passkeys_unavailable");
    return rp;
  }

  private async activeCount(executor: DbExecutor, accountId: string): Promise<number> {
    const [row] = await executor
      .select({ n: count() })
      .from(patientPasskey)
      .where(and(eq(patientPasskey.accountId, accountId), isNull(patientPasskey.revokedAt)));
    return row?.n ?? 0;
  }

  /**
   * A random challenge, stored only as the hash of its base64url form (what the browser signs and sends back),
   * single-use and short-lived. The bytes go to the options; a string would be encoded once more by the library.
   */
  private async newChallenge(account: PatientPortalAccountRecord, purpose: "register" | "sign_in"): Promise<Uint8Array<ArrayBuffer>> {
    const challenge = new Uint8Array(randomBytes(32));
    await this.db.insert(patientPasskeyChallenge).values({
      organizationId: account.organizationId,
      accountId: account.id,
      purpose,
      challengeHash: sha256Hex(isoBase64URL.fromBuffer(challenge)),
      expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_MINUTES * 60_000),
    });
    return challenge;
  }

  /** Spends the challenge the browser signed, if it is this account's, of this purpose, unused and unexpired. */
  private async consumeChallenge(
    executor: DbExecutor,
    accountId: string,
    purpose: "register" | "sign_in",
    clientDataJSON: string | undefined,
  ): Promise<string | null> {
    let challenge: string;
    try {
      challenge = decodeClientDataJSON(clientDataJSON ?? "").challenge;
    } catch {
      return null;
    }
    if (typeof challenge !== "string" || challenge.length === 0) return null;
    const [row] = await executor
      .update(patientPasskeyChallenge)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(patientPasskeyChallenge.accountId, accountId),
          eq(patientPasskeyChallenge.purpose, purpose),
          eq(patientPasskeyChallenge.challengeHash, sha256Hex(challenge)),
          isNull(patientPasskeyChallenge.usedAt),
          gt(patientPasskeyChallenge.expiresAt, new Date()),
        ),
      )
      .returning({ id: patientPasskeyChallenge.id });
    return row ? challenge : null;
  }

  private async alert(account: PatientPortalAccountRecord, event: SecurityAlertEvent, detail?: string): Promise<void> {
    await this.mailer
      .sendSecurityAlert({ organizationId: account.organizationId, patientId: account.patientId, eventId: randomUUID(), event, detail })
      .catch((error: unknown) => this.logger.warn(`Security notice "${event}" was not sent: ${String(error)}`));
  }
}
