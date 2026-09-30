import type { DbExecutor } from "@healthcare/core";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { appUser, type AppUserRecord, staffRecoveryCode } from "./auth.schema";
import { hashRecoveryCode, type SecondFactorKind, secondFactorKind } from "./second-factor";
import { verifyTotpStep } from "./totp";

export type SecondFactorResult = { ok: true; kind: SecondFactorKind; recoveryCodesLeft?: number } | { ok: false };

/**
 * Checks the app's code (a time step not newer than the last accepted one is refused: a code works once) or, where
 * allowed, a recovery code, and spends it — in the caller's transaction, with the account row locked (`FOR UPDATE`).
 * `secret` is the decrypted TOTP secret.
 */
export async function spendSecondFactor(
  tx: DbExecutor,
  user: Pick<AppUserRecord, "id" | "mfaLastUsedStep">,
  secret: string,
  code: string,
  allowRecovery: boolean,
): Promise<SecondFactorResult> {
  const kind = secondFactorKind(code);
  if (!kind) return { ok: false };
  if (kind === "totp") {
    const step = verifyTotpStep(secret, code.replace(/\s+/g, ""));
    if (step === null || (user.mfaLastUsedStep !== null && step <= user.mfaLastUsedStep)) return { ok: false };
    await tx.update(appUser).set({ mfaLastUsedStep: step }).where(eq(appUser.id, user.id));
    return { ok: true, kind };
  }
  if (!allowRecovery) return { ok: false };
  const [used] = await tx
    .update(staffRecoveryCode)
    .set({ usedAt: new Date() })
    .where(and(eq(staffRecoveryCode.userId, user.id), eq(staffRecoveryCode.codeHash, hashRecoveryCode(user.id, code)), isNull(staffRecoveryCode.usedAt)))
    .returning({ id: staffRecoveryCode.id });
  if (!used) return { ok: false };
  const [left] = await tx
    .select({ n: count() })
    .from(staffRecoveryCode)
    .where(and(eq(staffRecoveryCode.userId, user.id), isNull(staffRecoveryCode.usedAt)));
  return { ok: true, kind, recoveryCodesLeft: left?.n ?? 0 };
}

/** Turns a person's two-step verification off: secret, pending secret, last step and recovery codes (own disable, admin reset). */
export async function clearStaffMfa(tx: DbExecutor, userId: string): Promise<void> {
  await tx
    .update(appUser)
    .set({
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      mfaPendingSecretEncrypted: null,
      mfaLastUsedStep: null,
      updatedAt: new Date(),
      version: sql`${appUser.version} + 1`,
    })
    .where(eq(appUser.id, userId));
  await tx.delete(staffRecoveryCode).where(eq(staffRecoveryCode.userId, userId));
}
