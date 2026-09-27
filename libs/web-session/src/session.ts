import { createHash } from "node:crypto";

/** What both the staff and patient token endpoints return. */
export interface SessionTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface SessionCookieNames {
  access: string;
  refresh: string;
  /** Extra short-lived cookies to clear on sign-out (e.g. an MFA challenge). */
  transient?: string[];
}

/** The subset of Next's request/response cookie stores we write to. */
export interface CookieWriter {
  set(name: string, value: string, options: CookieOptions): unknown;
  delete(name: string): unknown;
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict";
  path: string;
  maxAge?: number;
  expires?: Date;
}

/** Refresh the access token this many seconds before it expires. */
export const ACCESS_TOKEN_SKEW_SECONDS = 30;

export function writeTokenCookies(jar: CookieWriter, names: SessionCookieNames, tokens: SessionTokens, secure: boolean, now = Date.now()): void {
  const base = { httpOnly: true, secure, sameSite: "lax", path: "/" } as const;
  jar.set(names.access, tokens.accessToken, { ...base, maxAge: Math.max(tokens.expiresIn - ACCESS_TOKEN_SKEW_SECONDS, 1) });
  const refreshExpires = new Date(tokens.refreshTokenExpiresAt);
  jar.set(names.refresh, tokens.refreshToken, {
    ...base,
    // `strict` keeps the long-lived token off every cross-site navigation.
    sameSite: "strict",
    expires: Number.isNaN(refreshExpires.getTime()) ? new Date(now + 24 * 3600_000) : refreshExpires,
  });
}

export function clearSessionCookies(jar: CookieWriter, names: SessionCookieNames): void {
  jar.delete(names.access);
  jar.delete(names.refresh);
  for (const name of names.transient ?? []) jar.delete(name);
}

/**
 * `rejected`: the refresh token is invalid, expired or revoked — sign in again.
 * `unavailable`: rate limit, server error or network failure — keep the session and retry later.
 */
export type RefreshResult<T extends SessionTokens = SessionTokens> = { status: "ok"; tokens: T } | { status: "rejected" } | { status: "unavailable" };

type Fetch = typeof fetch;

export interface Refresher<T extends SessionTokens> {
  refresh(refreshToken: string, fetchImpl?: Fetch, now?: number, forwarded?: Record<string, string>): Promise<RefreshResult<T>>;
  /** Test hook. */
  reset(): void;
}

/**
 * Single-flight refresh against an endpoint that rotates refresh tokens and
 * treats reuse of a rotated token as theft (revoking the session).
 *
 * Parallel requests from one browser — page loads, prefetches, server actions —
 * can all arrive with the same expired access token, so every refresh for a
 * given refresh token shares one API call, and a successful result is reused
 * for a grace window by requests still carrying the old cookie. Transient
 * failures are not cached, so the next request retries.
 *
 * State is per server process: running several instances of an app needs
 * sticky sessions or a shared store (e.g. Redis) for the same guarantee.
 */
export function createRefresher<T extends SessionTokens>(url: string, graceMs = 30_000): Refresher<T> {
  const inflight = new Map<string, { at: number; result: Promise<RefreshResult<T>> }>();
  return {
    refresh(refreshToken, fetchImpl = fetch, now = Date.now(), forwarded = {}) {
      for (const [key, entry] of inflight) if (now - entry.at > graceMs) inflight.delete(key);
      const key = createHash("sha256").update(refreshToken).digest("hex");
      const hit = inflight.get(key);
      if (hit) return hit.result;
      const result: Promise<RefreshResult<T>> = fetchImpl(url, {
        method: "POST",
        headers: { ...forwarded, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      })
        .then(async (res): Promise<RefreshResult<T>> => {
          if (res.ok) return { status: "ok", tokens: (await res.json()) as T };
          return res.status === 429 || res.status >= 500 ? { status: "unavailable" } : { status: "rejected" };
        })
        .catch((): RefreshResult<T> => ({ status: "unavailable" }));
      inflight.set(key, { at: now, result });
      void result.then((r) => {
        if (r.status === "unavailable" && inflight.get(key)?.result === result) inflight.delete(key);
      });
      return result;
    },
    reset() {
      inflight.clear();
    },
  };
}
