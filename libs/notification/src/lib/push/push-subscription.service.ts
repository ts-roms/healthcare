import { Inject, Injectable } from "@nestjs/common";
import { BusinessRuleError, DATABASE, type Database, NotFoundError } from "@healthcare/core";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { type PushDeviceKind, type PushRevokedReason, pushSubscription, type PushSubscriptionRecord, pushTicket } from "./push-subscription.schema";

/** An owner's devices that may receive push, at most this many at once. */
export const MAX_PUSH_DEVICES = 5;
/** A device that fails this many times in a row is dropped (the patient can turn it on again). */
export const MAX_PUSH_FAILURES = 5;

export interface PushDeviceView {
  id: string;
  /** A short description: from the browser's own identification ("Chrome on Android"), or the app's own name for the device. */
  label: string;
  kind: PushDeviceKind;
  createdAt: string;
  lastSuccessAt: string | null;
}

export interface MobileDevice {
  /** The Expo push token the app obtained from the operating system. */
  token: string;
  platform: "ios" | "android";
  /** The name the person gave the phone, if the app could read it. */
  deviceName?: string;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Who a device belongs to: a MyHealth account or a staff account (migration 0101). */
export type PushOwner = { portalAccountId: string; userId?: undefined } | { userId: string; portalAccountId?: undefined };

/** Rows of either kind of owner; ids are UUIDs, so one id never names both. */
const ownedBy = (ownerId: string) => or(eq(pushSubscription.portalAccountId, ownerId), eq(pushSubscription.userId, ownerId));

/**
 * The devices a MyHealth account — or, since migration 0101, a staff account — has allowed to receive push
 * (docs/domains/notification.md, "Push"). One row per browser address; a device that signs in as another owner moves to
 * that owner, so the previous person stops receiving there. A device the push service reports gone, or that keeps
 * failing, is dropped. Every method takes the owner's id (the account's or the user's); the notification's destination
 * is that id.
 */
@Injectable()
export class PushSubscriptionService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(ownerId: string): Promise<PushDeviceView[]> {
    const rows = await this.active(ownerId);
    return rows.map(toDeviceView);
  }

  /** The id of the owner's device with this browser address, if it is registered and active. */
  async idOfEndpoint(ownerId: string, endpoint: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: pushSubscription.id })
      .from(pushSubscription)
      .where(and(ownedBy(ownerId), eq(pushSubscription.endpoint, endpoint), isNull(pushSubscription.revokedAt)));
    return row?.id ?? null;
  }

  async register(organizationId: string, accountId: string, subscription: BrowserSubscription, userAgent: string | undefined): Promise<PushDeviceView> {
    return this.registerBrowser(organizationId, { portalAccountId: accountId }, subscription, userAgent);
  }

  /** A staff member's browser (same limits and rules; the owner is the user). */
  async registerForUser(organizationId: string, userId: string, subscription: BrowserSubscription, userAgent: string | undefined): Promise<PushDeviceView> {
    return this.registerBrowser(organizationId, { userId }, subscription, userAgent);
  }

  private registerBrowser(organizationId: string, owner: PushOwner, subscription: BrowserSubscription, userAgent: string | undefined): Promise<PushDeviceView> {
    return this.save(organizationId, owner, {
      kind: "web",
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: userAgent?.slice(0, 512) ?? null,
      deviceLabel: null,
    });
  }

  /** The MyHealth app registers its Expo push token: same limits and same account rules as a browser. */
  async registerMobile(organizationId: string, accountId: string, device: MobileDevice): Promise<PushDeviceView> {
    const system = device.platform === "ios" ? "iPhone" : "Android";
    const name = device.deviceName?.trim().slice(0, 60);
    return this.save(
      organizationId,
      { portalAccountId: accountId },
      {
        kind: "expo",
        endpoint: device.token,
        p256dh: null,
        auth: null,
        userAgent: null,
        deviceLabel: name ? `MyHealth app on ${name}` : `MyHealth app on ${system}`,
      },
    );
  }

  private async save(
    organizationId: string,
    owner: PushOwner,
    device: { kind: PushDeviceKind; endpoint: string; p256dh: string | null; auth: string | null; userAgent: string | null; deviceLabel: string | null },
  ): Promise<PushDeviceView> {
    const ownerId = owner.portalAccountId ?? owner.userId;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push:${ownerId}`}, 0))`);
      const [existing] = await tx.select().from(pushSubscription).where(eq(pushSubscription.endpoint, device.endpoint)).for("update");
      const [active] = await tx
        .select({ n: count() })
        .from(pushSubscription)
        .where(and(ownedBy(ownerId), isNull(pushSubscription.revokedAt)));
      const alreadyMine = existing && (existing.portalAccountId ?? existing.userId) === ownerId && !existing.revokedAt;
      if (!alreadyMine && (active?.n ?? 0) >= MAX_PUSH_DEVICES) {
        throw new BusinessRuleError(`You can receive notifications on up to ${MAX_PUSH_DEVICES} devices. Remove one first.`, "too_many_push_devices");
      }
      const values = {
        organizationId,
        portalAccountId: owner.portalAccountId ?? null,
        userId: owner.userId ?? null,
        ...device,
        revokedAt: null,
        revokedReason: null,
        failureCount: 0,
      };
      const [row] = existing
        ? await tx.update(pushSubscription).set(values).where(eq(pushSubscription.id, existing.id)).returning()
        : await tx.insert(pushSubscription).values(values).returning();
      return toDeviceView(row!);
    });
  }

  /** The owner removes one of their devices (`removed_by_patient` for a MyHealth account, `removed_by_user` for staff). */
  async remove(ownerId: string, id: string, reason: "removed_by_patient" | "removed_by_user" = "removed_by_patient"): Promise<void> {
    const [row] = await this.db
      .update(pushSubscription)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(pushSubscription.id, id), ownedBy(ownerId), isNull(pushSubscription.revokedAt)))
      .returning({ id: pushSubscription.id });
    if (!row) throw new NotFoundError("Device");
  }

  /** Every device of an owner stops receiving push. */
  async revokeAll(ownerId: string, reason: PushRevokedReason): Promise<void> {
    await this.db
      .update(pushSubscription)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(ownedBy(ownerId), isNull(pushSubscription.revokedAt)));
  }

  async hasDevice(ownerId: string): Promise<boolean> {
    return (await this.active(ownerId)).length > 0;
  }

  async active(ownerId: string): Promise<PushSubscriptionRecord[]> {
    return this.db
      .select()
      .from(pushSubscription)
      .where(and(ownedBy(ownerId), isNull(pushSubscription.revokedAt)))
      .orderBy(asc(pushSubscription.createdAt));
  }

  /** Keeps an Expo ticket so its receipt can be read later (ExpoPushReceipts). A repeated ticket id is ignored. */
  async recordTicket(device: PushSubscriptionRecord, ticketId: string, notificationId: string | null): Promise<void> {
    await this.db
      .insert(pushTicket)
      .values({ organizationId: device.organizationId, pushSubscriptionId: device.id, notificationId, ticketId: ticketId.slice(0, 100) })
      .onConflictDoNothing({ target: pushTicket.ticketId });
  }

  /** Records what happened sending to a device; a device the push service says is gone, or that keeps failing, is dropped. */
  async recordResult(id: string, outcome: "sent" | "gone" | "failed"): Promise<void> {
    const now = new Date();
    if (outcome === "sent") {
      await this.db.update(pushSubscription).set({ lastSuccessAt: now, failureCount: 0 }).where(eq(pushSubscription.id, id));
    } else if (outcome === "gone") {
      await this.db
        .update(pushSubscription)
        .set({ revokedAt: now, revokedReason: "gone", lastFailureAt: now })
        .where(and(eq(pushSubscription.id, id), isNull(pushSubscription.revokedAt)));
    } else {
      const [row] = await this.db
        .update(pushSubscription)
        .set({ lastFailureAt: now, failureCount: sql`${pushSubscription.failureCount} + 1` })
        .where(eq(pushSubscription.id, id))
        .returning({ failureCount: pushSubscription.failureCount });
      if ((row?.failureCount ?? 0) >= MAX_PUSH_FAILURES) {
        await this.db
          .update(pushSubscription)
          .set({ revokedAt: now, revokedReason: "failing" })
          .where(and(eq(pushSubscription.id, id), isNull(pushSubscription.revokedAt)));
      }
    }
  }
}

function toDeviceView(r: PushSubscriptionRecord): PushDeviceView {
  return {
    id: r.id,
    label: r.deviceLabel ?? describeDevice(r.userAgent),
    kind: r.kind,
    createdAt: r.createdAt.toISOString(),
    lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
  };
}

/** "Chrome on Android", "Safari on iPhone", "Firefox on Windows": from the browser's own identification, no more. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const system = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iPhone or iPad"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return system ? `${browser} on ${system}` : browser;
}
