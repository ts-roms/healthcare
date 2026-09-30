import type { DbExecutor } from "@healthcare/core";
import { eq, sql } from "drizzle-orm";
import { appUser, staffRecoveryCode } from "./auth.schema";

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
