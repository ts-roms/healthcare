import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import { DATABASE, type Database, type DbExecutor, NotFoundError, randomToken, sha256Hex } from "@healthcare/core";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { type PatientPortalAccountRecord, patientTrustedDevice, type TrustedDeviceRevokeReason } from "../portal/portal.schema";
import { deviceLabel, TRUSTED_DEVICE_DAYS, TRUSTED_DEVICE_LIMIT } from "./portal-security.rules";

export interface TrustedDeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** The device this request came from. */
  current: boolean;
}

/**
 * Browsers a patient asked not to be asked for a second-step code on again (migration 0100,
 * docs/architecture/portal-app.md). The browser holds a random token; the platform keeps its hash, a short label, and
 * when it expires. A device skips the code only with the right password; it never replaces one.
 */
@Injectable()
export class PortalTrustedDeviceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Remembers the browser of a sign-in that just passed its second step; the oldest device makes room past the limit. */
  async trust(tx: DbExecutor, account: PatientPortalAccountRecord, context: PatientAuditContext): Promise<{ deviceToken: string; expiresAt: Date }> {
    const active = await tx
      .select({ id: patientTrustedDevice.id })
      .from(patientTrustedDevice)
      .where(and(eq(patientTrustedDevice.accountId, account.id), isNull(patientTrustedDevice.revokedAt), gt(patientTrustedDevice.expiresAt, new Date())))
      .orderBy(asc(patientTrustedDevice.lastUsedAt));
    for (const old of active.slice(0, Math.max(0, active.length - (TRUSTED_DEVICE_LIMIT - 1)))) {
      await tx.update(patientTrustedDevice).set({ revokedAt: new Date(), revokedReason: "replaced" }).where(eq(patientTrustedDevice.id, old.id));
    }
    const deviceToken = randomToken();
    const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_DAYS * 86_400_000);
    const [row] = await tx
      .insert(patientTrustedDevice)
      .values({
        organizationId: account.organizationId,
        accountId: account.id,
        tokenHash: sha256Hex(deviceToken),
        label: deviceLabel(context.request.userAgent),
        expiresAt,
      })
      .returning();
    await this.audit.record(tx, context, {
      action: "portal.device-trust",
      resourceType: "patient_trusted_device",
      resourceId: row!.id,
      metadata: { label: row!.label, expiresAt: expiresAt.toISOString() },
    });
    return { deviceToken, expiresAt };
  }

  /** The device a token names, if it is the account's, unexpired and not forgotten; marks it used. */
  async recognise(accountId: string, deviceToken: string): Promise<{ id: string; label: string } | null> {
    const [row] = await this.db
      .select({ id: patientTrustedDevice.id, label: patientTrustedDevice.label })
      .from(patientTrustedDevice)
      .where(
        and(
          eq(patientTrustedDevice.accountId, accountId),
          eq(patientTrustedDevice.tokenHash, sha256Hex(deviceToken)),
          isNull(patientTrustedDevice.revokedAt),
          gt(patientTrustedDevice.expiresAt, new Date()),
        ),
      );
    if (!row) return null;
    await this.db.update(patientTrustedDevice).set({ lastUsedAt: new Date() }).where(eq(patientTrustedDevice.id, row.id));
    return row;
  }

  async list(accountId: string, currentToken: string | undefined): Promise<TrustedDeviceView[]> {
    const rows = await this.db
      .select()
      .from(patientTrustedDevice)
      .where(and(eq(patientTrustedDevice.accountId, accountId), isNull(patientTrustedDevice.revokedAt), gt(patientTrustedDevice.expiresAt, new Date())))
      .orderBy(desc(patientTrustedDevice.lastUsedAt));
    const currentHash = currentToken ? sha256Hex(currentToken) : null;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      current: r.tokenHash === currentHash,
    }));
  }

  /** Forgets one device of the signed-in account (audited). */
  async forget(context: PatientAuditContext, deviceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(patientTrustedDevice)
        .set({ revokedAt: new Date(), revokedReason: "forgotten_by_patient" })
        .where(and(eq(patientTrustedDevice.accountId, context.accountId), eq(patientTrustedDevice.id, deviceId), isNull(patientTrustedDevice.revokedAt)))
        .returning({ id: patientTrustedDevice.id });
      if (!row) throw new NotFoundError("Device");
      await this.audit.record(tx, context, { action: "portal.device-forget", resourceType: "patient_trusted_device", resourceId: deviceId });
    });
  }

  /** Forgets every device of the signed-in account (audited). */
  async forgetAll(context: PatientAuditContext): Promise<number> {
    return this.db.transaction(async (tx) => {
      const count = await this.revokeAll(tx, context.accountId, "forgotten_all");
      await this.audit.record(tx, context, { action: "portal.device-forget", resourceType: "patient_trusted_device", metadata: { all: true, count } });
      return count;
    });
  }

  /** Every device of an account, when two-step verification ends or every session is ended. Not audited here. */
  async revokeAll(executor: DbExecutor, accountId: string, reason: TrustedDeviceRevokeReason): Promise<number> {
    const rows = await executor
      .update(patientTrustedDevice)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(patientTrustedDevice.accountId, accountId), isNull(patientTrustedDevice.revokedAt)))
      .returning({ id: patientTrustedDevice.id });
    return rows.length;
  }
}
