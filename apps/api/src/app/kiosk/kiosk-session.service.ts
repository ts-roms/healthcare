import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, asPlatform, BusinessRuleError, DATABASE, type Database } from "@healthcare/core";
import { PatientIdentityService } from "@healthcare/patient";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { KioskDeviceService } from "./kiosk-device.service";
import type { identifySchema } from "./kiosk.dto";
import {
  DEVICE_FAILURE_WINDOW_MS,
  deviceCoolingDown,
  hashSessionToken,
  MAX_IDENTIFY_ATTEMPTS,
  newSessionToken,
  SESSION_IDLE_MS,
  sessionDeadline,
} from "./kiosk.rules";
import { kioskSession, type KioskSessionRecord } from "./kiosk.schema";

/** The same answer for every way identification can fail, so the screen never tells which part was wrong. */
const NOT_FOUND = "We could not find a matching record. Please check what you entered, or see the front desk.";

const coolingDown = () => new BusinessRuleError("This kiosk cannot look up records right now. Please see the front desk.", "kiosk_cooling_down");

const sessionEnded = () => new BusinessRuleError("Your session has ended. Please start again.", "kiosk_session_expired");

/**
 * A person's time at a kiosk (docs/domains/kiosk.md). The screen holds only a random token; the server holds its hash,
 * the device it belongs to and, once the person has been recognised, the patient id (kept after the session ends as the
 * record of who was served; the audit trail holds the same fact). A session ends when the person
 * finishes, after two idle minutes, at fifteen minutes in all, or when identification fails three times.
 */
@Injectable()
export class KioskSessionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly devices: KioskDeviceService,
    private readonly identity: PatientIdentityService,
  ) {}

  /** Wrong identification answers on this kiosk in the recent window, across all its sessions. */
  private async recentFailures(deviceId: string, now: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`coalesce(sum(${kioskSession.failedAttempts}), 0)::int` })
      .from(kioskSession)
      .where(and(eq(kioskSession.deviceId, deviceId), gt(kioskSession.createdAt, new Date(now.getTime() - DEVICE_FAILURE_WINDOW_MS))));
    return row?.n ?? 0;
  }

  async open(actor: Actor): Promise<{ token: string; expiresAt: Date; idleSeconds: number }> {
    const device = await this.devices.requireDevice(actor, { serving: true });
    const token = newSessionToken();
    const now = new Date();
    if (deviceCoolingDown(await this.recentFailures(device.id, now))) throw coolingDown();
    const expiresAt = sessionDeadline(now, now);
    await this.db.transaction(async (tx) => {
      // A kiosk serves one person at a time: a new session ends any the device still has open.
      await tx
        .update(kioskSession)
        .set({ status: "ended", endedAt: now })
        .where(and(eq(kioskSession.deviceId, device.id), eq(kioskSession.status, "active")));
      const [created] = await tx
        .insert(kioskSession)
        .values({ organizationId: actor.organizationId, facilityId: device.facilityId, deviceId: device.id, tokenHash: hashSessionToken(token), expiresAt })
        .returning({ id: kioskSession.id });
      await this.audit.record(tx, actor, {
        action: "kiosk.session.open",
        resourceType: "kiosk_session",
        resourceId: created?.id,
        metadata: { deviceId: device.id },
      });
    });
    return { token, expiresAt, idleSeconds: SESSION_IDLE_MS / 1000 };
  }

  /**
   * The active session the token names, if it belongs to the calling kiosk. Anything else — unknown token, another
   * kiosk's session, ended, expired — is the same "session ended" answer. A valid call extends the idle deadline.
   */
  async resolve(actor: Actor, token: string | undefined, options: { identified?: boolean } = {}): Promise<KioskSessionRecord> {
    if (!token) throw sessionEnded();
    const device = await this.devices.requireDevice(actor, { serving: true });
    const [row] = await this.db
      .select()
      .from(kioskSession)
      .where(and(eq(kioskSession.organizationId, actor.organizationId), eq(kioskSession.tokenHash, hashSessionToken(token))));
    if (!row || row.deviceId !== device.id || row.status !== "active") throw sessionEnded();
    const now = new Date();
    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.db
        .update(kioskSession)
        .set({ status: "expired", endedAt: now })
        .where(and(eq(kioskSession.id, row.id), eq(kioskSession.status, "active")));
      throw sessionEnded();
    }
    if (options.identified && !row.patientId) {
      throw new BusinessRuleError("Please tell us who you are first.", "kiosk_not_identified");
    }
    const expiresAt = sessionDeadline(row.createdAt, now);
    await this.db.update(kioskSession).set({ lastActivityAt: now, expiresAt }).where(eq(kioskSession.id, row.id));
    return { ...row, lastActivityAt: now, expiresAt };
  }

  /**
   * Recognises the person in the Patient Master. Three things must agree (patient or mobile number, date of birth,
   * given name). Each attempt is reserved on the session *before* the lookup, in one atomic statement that refuses a
   * further attempt once the limit is reached, so guesses sent in parallel cannot beat it; the reservation is given back
   * when the person is recognised. The third miss locks the session. Success shows initials only — never the name.
   */
  async identify(actor: Actor, token: string | undefined, input: z.infer<typeof identifySchema>) {
    const session = await this.resolve(actor, token);
    if (session.patientId) throw new BusinessRuleError("You are already identified.", "kiosk_already_identified");

    const [reserved] = await this.db
      .update(kioskSession)
      .set({ failedAttempts: sql`${kioskSession.failedAttempts} + 1` })
      .where(
        and(
          eq(kioskSession.id, session.id),
          eq(kioskSession.status, "active"),
          isNull(kioskSession.patientId),
          lt(kioskSession.failedAttempts, MAX_IDENTIFY_ATTEMPTS),
        ),
      )
      .returning({ failedAttempts: kioskSession.failedAttempts });
    if (!reserved) {
      // The attempts are used up (others are still being answered) or the session ended meanwhile.
      const [current] = await this.db.select({ status: kioskSession.status }).from(kioskSession).where(eq(kioskSession.id, session.id));
      throw current?.status === "active" || current?.status === "locked"
        ? new BusinessRuleError("Please see the front desk for help.", "kiosk_session_locked")
        : sessionEnded();
    }
    const attempts = reserved.failedAttempts;
    const giveBack = () =>
      this.db
        .update(kioskSession)
        .set({ failedAttempts: sql`greatest(${kioskSession.failedAttempts} - 1, 0)` })
        .where(eq(kioskSession.id, session.id));

    // The kiosk's own budget counts the reservation made above, so a burst cannot slip past it either.
    if (deviceCoolingDown((await this.recentFailures(session.deviceId, new Date())) - 1)) {
      await giveBack();
      throw coolingDown();
    }

    const match = await this.identity.verify(actor.organizationId, input);
    if (!match) {
      const locked = attempts >= MAX_IDENTIFY_ATTEMPTS;
      if (locked) {
        await this.db
          .update(kioskSession)
          .set({ status: "locked", endedAt: new Date() })
          .where(and(eq(kioskSession.id, session.id), eq(kioskSession.status, "active")));
      }
      await this.audit.recordStandalone(actor, {
        action: "kiosk.identify",
        resourceType: "kiosk_session",
        resourceId: session.id,
        outcome: "denied",
        metadata: { attempts, locked },
      });
      throw new BusinessRuleError(locked ? "Please see the front desk for help." : NOT_FOUND, locked ? "kiosk_session_locked" : "identification_failed");
    }
    await giveBack();
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(kioskSession)
        .set({ patientId: match.patientId, identifiedAt: new Date() })
        .where(and(eq(kioskSession.id, session.id), eq(kioskSession.status, "active"), isNull(kioskSession.patientId)))
        .returning({ id: kioskSession.id });
      if (!updated) throw sessionEnded();
      await this.audit.record(tx, actor, {
        action: "kiosk.identify",
        resourceType: "kiosk_session",
        resourceId: session.id,
        patientId: match.patientId,
        metadata: { attempts },
      });
    });
    return { maskedName: match.maskedName, birthYear: match.birthYear };
  }

  /** The person is done (or walked away): nothing about them stays on the session. */
  async end(actor: Actor, token: string | undefined): Promise<void> {
    if (!token) return;
    const device = await this.devices.requireDevice(actor, { serving: false });
    await this.db
      .update(kioskSession)
      .set({ status: "ended", endedAt: new Date() })
      .where(
        and(
          eq(kioskSession.organizationId, actor.organizationId),
          eq(kioskSession.deviceId, device.id),
          eq(kioskSession.tokenHash, hashSessionToken(token)),
          eq(kioskSession.status, "active"),
        ),
      );
  }

  /** Closes sessions nobody ended. Safe on several API instances (it is one idempotent statement). */
  async expireDue(now = new Date()): Promise<number> {
    return asPlatform("kiosk session expiry", async () => {
      const rows = await this.db
        .update(kioskSession)
        .set({ status: "expired", endedAt: now })
        .where(and(eq(kioskSession.status, "active"), lt(kioskSession.expiresAt, now)))
        .returning({ id: kioskSession.id });
      return rows.length;
    });
  }
}
