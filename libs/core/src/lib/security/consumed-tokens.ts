import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { DATABASE, type Database } from "../database/database";
import { sha256Hex } from "./crypto";

/** Mirrors database/migrations/0147_consumed_token.sql (the migration is the source of truth). */
export const consumedToken = pgTable("consumed_token", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConsumedTokenKind = "staff_mfa_challenge" | "staff_realtime_ticket" | "patient_mfa_challenge" | "patient_realtime_ticket";

/**
 * Spends a short-lived signed token once (zero trust: a captured challenge or ticket cannot be replayed within its
 * lifetime). Only the token's SHA-256 is stored, until it expires.
 */
@Injectable()
export class ConsumedTokens {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Records `token` as used. Returns false when it was already used (the caller refuses it). `expiresAt` is the
   * token's own expiry (its `exp`), after which the row is no longer needed.
   */
  async consume(kind: ConsumedTokenKind, token: string, expiresAt: Date): Promise<boolean> {
    const inserted = await this.db
      .insert(consumedToken)
      .values({ tokenHash: sha256Hex(token), kind, expiresAt })
      .onConflictDoNothing()
      .returning({ tokenHash: consumedToken.tokenHash });
    // Expired rows go as new ones arrive: the table stays the size of a few minutes of sign-ins and sockets.
    if (inserted.length > 0 && Math.random() < 0.05) await this.db.execute(sql`DELETE FROM consumed_token WHERE expires_at < now() - interval '1 hour'`);
    return inserted.length > 0;
  }
}

/** A JWT's expiry (`exp`, seconds) as a date; a token without one is treated as expiring in an hour. */
export function tokenExpiry(claims: object): Date {
  const exp = (claims as { exp?: unknown }).exp;
  return typeof exp === "number" ? new Date(exp * 1000) : new Date(Date.now() + 3_600_000);
}

/** Whether a session last used at `lastUsedAt` has been idle past `idleMinutes` (0: never). Staff and MyHealth alike. */
export function sessionIdle(lastUsedAt: Date, now: Date, idleMinutes: number): boolean {
  return idleMinutes > 0 && now.getTime() - lastUsedAt.getTime() > idleMinutes * 60_000;
}
