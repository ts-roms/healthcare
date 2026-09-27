import { Inject, Injectable } from '@nestjs/common';
import {
  APP_CONFIG,
  type AppConfig,
  DATABASE,
  type Database,
  type DbExecutor,
  randomToken,
  type RequestMetadata,
  sha256Hex,
  UnauthenticatedError,
} from '@healthcare/core';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { authSession, type AuthSessionRecord } from './auth.schema';

export interface IssuedSession {
  session: AuthSessionRecord;
  refreshToken: string;
}

export type RotateResult =
  | { kind: 'rotated'; session: AuthSessionRecord; refreshToken: string }
  | { kind: 'reuse_detected'; session: AuthSessionRecord }
  | { kind: 'invalid' };

/**
 * Refresh-token sessions with rotation. Each refresh replaces the token; a
 * previously rotated token being presented again means it was stolen, so the
 * whole session is revoked.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(executor: DbExecutor, userId: string, organizationId: string, request: RequestMetadata): Promise<IssuedSession> {
    const refreshToken = randomToken();
    const [session] = await executor
      .insert(authSession)
      .values({
        userId,
        organizationId,
        refreshTokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        ipAddress: request.ipAddress ?? null,
        userAgent: request.userAgent?.slice(0, 512) ?? null,
      })
      .returning();
    if (!session) throw new Error('Session insert returned no row');
    return { session, refreshToken };
  }

  async findActive(sessionId: string): Promise<AuthSessionRecord | undefined> {
    const [session] = await this.db
      .select()
      .from(authSession)
      .where(and(eq(authSession.id, sessionId), isNull(authSession.revokedAt), gt(authSession.expiresAt, new Date())));
    return session;
  }

  async rotate(refreshToken: string): Promise<RotateResult> {
    const hash = sha256Hex(refreshToken);
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(authSession).where(eq(authSession.refreshTokenHash, hash)).for('update');
      if (current) {
        if (current.revokedAt || current.expiresAt <= new Date()) return { kind: 'invalid' };
        const next = randomToken();
        const [rotated] = await tx
          .update(authSession)
          .set({ refreshTokenHash: sha256Hex(next), previousRefreshTokenHash: hash, lastUsedAt: new Date() })
          .where(eq(authSession.id, current.id))
          .returning();
        if (!rotated) return { kind: 'invalid' };
        return { kind: 'rotated', session: rotated, refreshToken: next };
      }
      const [reused] = await tx.select().from(authSession).where(eq(authSession.previousRefreshTokenHash, hash)).for('update');
      if (reused && !reused.revokedAt) {
        await tx
          .update(authSession)
          .set({ revokedAt: new Date(), revokedReason: 'refresh_token_reuse' })
          .where(eq(authSession.id, reused.id));
        return { kind: 'reuse_detected', session: reused };
      }
      return { kind: 'invalid' };
    });
  }

  async revoke(executor: DbExecutor, sessionId: string, reason: string): Promise<void> {
    await executor
      .update(authSession)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(authSession.id, sessionId), isNull(authSession.revokedAt)));
  }

  /** Revokes every active session of the user, optionally keeping one. */
  async revokeAllForUser(executor: DbExecutor, userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const conditions = [eq(authSession.userId, userId), isNull(authSession.revokedAt)];
    if (exceptSessionId) conditions.push(ne(authSession.id, exceptSessionId));
    const revoked = await executor
      .update(authSession)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(and(...conditions))
      .returning({ id: authSession.id });
    return revoked.length;
  }

  /** Signals an invalid refresh token without revealing which check failed. */
  static invalid(): UnauthenticatedError {
    return new UnauthenticatedError('Refresh token is invalid or expired', 'invalid_refresh_token');
  }
}
