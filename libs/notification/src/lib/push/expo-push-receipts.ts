import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { asPlatform, DATABASE, type Database } from "@healthcare/core";
import { and, asc, eq, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { notification } from "../notification.schema";
import { EXPO_RECEIPTS_BATCH, expoErrorIsConfiguration, type ExpoPushReceipt, type ExpoPushTransport, expoTokenIsGone } from "./expo-push.transport";
import { pushTicket, type PushTicketRecord } from "./push-subscription.schema";
import { PushSubscriptionService } from "./push-subscription.service";

export const EXPO_PUSH_TRANSPORT = Symbol("EXPO_PUSH_TRANSPORT");

/** Expo advises waiting before asking; receipts are usually ready within 15 minutes. */
export const RECEIPT_DELAY_MS = 15 * 60_000;
/** Expo keeps a receipt for about a day; a ticket still unanswered after that is given up as `expired`. */
export const RECEIPT_LIFETIME_MS = 24 * 3_600_000;
/** Answered tickets are kept this long for troubleshooting, then removed (they hold ids and codes only). */
export const TICKET_RETENTION_MS = 30 * 24 * 3_600_000;
/** Most tickets checked in one round (several receipt requests of up to 1,000 ids each). */
const MAX_PER_ROUND = 5 * EXPO_RECEIPTS_BATCH;

export interface ReceiptRound {
  checked: number;
  delivered: number;
  gone: number;
  failed: number;
  configuration: number;
  waiting: number;
  expired: number;
}

/**
 * Reads Expo push receipts (docs/domains/notification.md, "Push"). A ticket only says Expo accepted a message; its
 * receipt, available later, says whether Apple or Google took it:
 *
 * - `ok` → the ticket is answered and its notification, if still `sent`, becomes `delivered` (handed to Apple/Google — not
 *   proof the patient saw it);
 * - `DeviceNotRegistered` → the app is gone from the phone: the device is dropped at once;
 * - `InvalidCredentials` / `MismatchSenderId` → the platform's own Apple or Firebase setup is wrong: logged for the
 *   operator, never counted against the patient's device;
 * - any other error (`MessageTooBig`, `MessageRateExceeded`, …) → counts toward the device's 5-failure limit;
 * - no receipt yet → asked again next round; after a day, `expired`.
 *
 * Runs every 15 minutes in the notification worker when `EXPO_PUSH_ENABLED`; one runner at a time across workers.
 */
@Injectable()
export class ExpoPushReceipts implements OnApplicationShutdown {
  private readonly logger = new Logger(ExpoPushReceipts.name);
  private timer?: NodeJS.Timeout;

  private readonly devices: PushSubscriptionService;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EXPO_PUSH_TRANSPORT) private readonly transport: ExpoPushTransport,
  ) {
    this.devices = new PushSubscriptionService(db);
  }

  start(intervalMs = RECEIPT_DELAY_MS): void {
    this.timer ??= setInterval(() => asPlatform("Expo push receipts", () => void this.tick()), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      const round = await this.run();
      if (round.checked > 0) this.logger.log(`Expo receipts: ${JSON.stringify(round)}`);
    } catch (error) {
      this.logger.error(`Reading Expo receipts failed: ${String(error)}`);
    }
  }

  async run(now = new Date()): Promise<ReceiptRound> {
    const round: ReceiptRound = { checked: 0, delivered: 0, gone: 0, failed: 0, configuration: 0, waiting: 0, expired: 0 };
    // One runner at a time across workers: a transaction-scoped lock, held on one pooled connection while the round runs.
    // The round's own writes are separate short statements, so a slow answer from Expo never holds row locks.
    await this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('expo-push-receipts')) AS locked`);
      if (!lock.rows[0]?.locked) return;
      await this.purge(now);
      const due = await this.db
        .select()
        .from(pushTicket)
        .where(and(isNull(pushTicket.receiptStatus), lte(pushTicket.sentAt, new Date(now.getTime() - RECEIPT_DELAY_MS))))
        .orderBy(asc(pushTicket.sentAt))
        .limit(MAX_PER_ROUND);
      for (let i = 0; i < due.length; i += EXPO_RECEIPTS_BATCH) {
        const batch = due.slice(i, i + EXPO_RECEIPTS_BATCH);
        let receipts: Record<string, ExpoPushReceipt>;
        try {
          receipts = await this.transport.receipts(batch.map((t) => t.ticketId));
        } catch (error) {
          // Expo unreachable or refusing: the tickets stay pending and are asked about next round.
          this.logger.warn(`Expo receipts could not be read: ${String(error)}`);
          continue;
        }
        for (const ticket of batch) await this.apply(ticket, receipts[ticket.ticketId], now, round);
      }
    });
    return round;
  }

  private async apply(ticket: PushTicketRecord, receipt: ExpoPushReceipt | undefined, now: Date, round: ReceiptRound): Promise<void> {
    round.checked += 1;
    if (!receipt) {
      if (now.getTime() - ticket.sentAt.getTime() >= RECEIPT_LIFETIME_MS) {
        await this.answer(ticket, "expired", null, now);
        round.expired += 1;
      } else {
        await this.db
          .update(pushTicket)
          .set({ checkCount: sql`${pushTicket.checkCount} + 1` })
          .where(eq(pushTicket.id, ticket.id));
        round.waiting += 1;
      }
      return;
    }
    if (receipt.status === "ok") {
      await this.db.transaction(async (tx) => {
        await tx
          .update(pushTicket)
          .set({ receiptStatus: "ok", checkedAt: now, checkCount: sql`${pushTicket.checkCount} + 1` })
          .where(eq(pushTicket.id, ticket.id));
        if (ticket.notificationId) {
          await tx
            .update(notification)
            .set({ status: "delivered", deliveredAt: now, updatedAt: now })
            .where(and(eq(notification.id, ticket.notificationId), eq(notification.status, "sent")));
        }
      });
      round.delivered += 1;
      return;
    }
    const code = (receipt.error ?? "Unknown").slice(0, 100);
    await this.answer(ticket, "error", code, now);
    if (expoTokenIsGone(receipt)) {
      await this.devices.recordResult(ticket.pushSubscriptionId, "gone");
      round.gone += 1;
    } else if (expoErrorIsConfiguration(receipt)) {
      this.logger.error(`Expo reports a push setup problem (${code}): check the Apple and Firebase credentials of the Expo project`);
      round.configuration += 1;
    } else {
      await this.devices.recordResult(ticket.pushSubscriptionId, "failed");
      round.failed += 1;
    }
  }

  private async answer(ticket: PushTicketRecord, status: "error" | "expired", error: string | null, now: Date): Promise<void> {
    await this.db
      .update(pushTicket)
      .set({ receiptStatus: status, receiptError: error, checkedAt: now, checkCount: sql`${pushTicket.checkCount} + 1` })
      .where(eq(pushTicket.id, ticket.id));
  }

  private async purge(now: Date): Promise<void> {
    await this.db.delete(pushTicket).where(and(isNotNull(pushTicket.checkedAt), lt(pushTicket.checkedAt, new Date(now.getTime() - TICKET_RETENTION_MS))));
  }
}
