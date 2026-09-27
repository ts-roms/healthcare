import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { catchError, from, Observable, of, switchMap, throwError } from "rxjs";
import "../http/request-augmentation";
import { DATABASE, type Database } from "../database/database";
import { BusinessRuleError, ConflictError } from "../errors";
import { sha256Hex } from "../security/crypto";

const HEADER = "idempotency-key";
const VALID_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RETENTION_HOURS = 24;

type Begin = { kind: "proceed" } | { kind: "replay"; status: number; body: unknown };

/**
 * Makes unsafe requests carrying an `Idempotency-Key` header safe to retry
 * (e.g. a registration submitted twice over a flaky connection):
 * - first request runs and its response is stored for 24 hours;
 * - a retry with the same key and body replays the stored response;
 * - the same key with a different body is rejected;
 * - a retry while the first is still running gets 409.
 * Keys are scoped per authenticated user.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const key = request.header(HEADER);
    if (!key || !UNSAFE_METHODS.has(request.method) || !request.actor) {
      return next.handle();
    }
    if (!VALID_KEY.test(key)) {
      return throwError(() => new BusinessRuleError("Idempotency-Key must be 8-128 characters of [A-Za-z0-9._:-]", "invalid_idempotency_key"));
    }
    const userId = request.actor.userId;
    const path = request.originalUrl.split("?")[0] ?? request.originalUrl;
    const requestHash = sha256Hex(`${request.method} ${path}\n${stableStringify(request.body ?? null)}`);

    return from(this.begin(userId, key, request.method, path, requestHash)).pipe(
      switchMap((begin) => {
        if (begin.kind === "replay") {
          response.status(begin.status).setHeader("Idempotent-Replayed", "true");
          return of(begin.body);
        }
        return next.handle().pipe(
          switchMap((body) => from(this.complete(userId, key, response.statusCode, body)).pipe(switchMap(() => of(body)))),
          catchError((error: unknown) => from(this.release(userId, key)).pipe(switchMap(() => throwError(() => error)))),
        );
      }),
    );
  }

  private async begin(userId: string, key: string, method: string, path: string, requestHash: string): Promise<Begin> {
    await this.db.execute(sql`
      DELETE FROM idempotency_record
      WHERE user_id = ${userId} AND idempotency_key = ${key} AND expires_at < now()`);
    const inserted = await this.db.execute(sql`
      INSERT INTO idempotency_record (user_id, idempotency_key, method, path, request_hash, expires_at)
      VALUES (${userId}, ${key}, ${method}, ${path}, ${requestHash}, now() + make_interval(hours => ${RETENTION_HOURS}))
      ON CONFLICT DO NOTHING
      RETURNING user_id`);
    if (inserted.rows.length > 0) return { kind: "proceed" };

    const existing = await this.db.execute<{
      request_hash: string;
      state: string;
      response_status: number | null;
      response_body: unknown;
    }>(sql`
      SELECT request_hash, state, response_status, response_body
      FROM idempotency_record WHERE user_id = ${userId} AND idempotency_key = ${key}`);
    const record = existing.rows[0];
    if (!record) return this.begin(userId, key, method, path, requestHash);
    if (record.request_hash !== requestHash) {
      throw new BusinessRuleError("Idempotency-Key was already used for a different request", "idempotency_key_reused");
    }
    if (record.state !== "completed" || record.response_status === null) {
      throw new ConflictError("A request with this Idempotency-Key is still being processed", undefined, "idempotency_in_progress");
    }
    return { kind: "replay", status: record.response_status, body: record.response_body };
  }

  private async complete(userId: string, key: string, status: number, body: unknown): Promise<void> {
    await this.db.execute(sql`
      UPDATE idempotency_record
      SET state = 'completed', response_status = ${status}, response_body = ${JSON.stringify(body ?? null)}::jsonb
      WHERE user_id = ${userId} AND idempotency_key = ${key}`);
  }

  /** A failed request does not consume the key, so the client may retry. */
  private async release(userId: string, key: string): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM idempotency_record
      WHERE user_id = ${userId} AND idempotency_key = ${key} AND state = 'in_progress'`);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
