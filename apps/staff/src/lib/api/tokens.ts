import { createHash } from "node:crypto";
import { ACCESS_TOKEN_SKEW_SECONDS, API_BASE_URL, COOKIES, SECURE_COOKIES } from "./config";
import type { TokenResponse } from "./types";

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

const base = { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/" } as const;

export function writeTokenCookies(jar: CookieWriter, tokens: TokenResponse, now = Date.now()): void {
  jar.set(COOKIES.access, tokens.accessToken, { ...base, maxAge: Math.max(tokens.expiresIn - ACCESS_TOKEN_SKEW_SECONDS, 1) });
  const refreshExpires = new Date(tokens.refreshTokenExpiresAt);
  jar.set(COOKIES.refresh, tokens.refreshToken, {
    ...base,
    // `strict` keeps the long-lived token off every cross-site navigation.
    sameSite: "strict",
    expires: Number.isNaN(refreshExpires.getTime()) ? new Date(now + 24 * 3600_000) : refreshExpires,
  });
}

export function clearSessionCookies(jar: CookieWriter): void {
  jar.delete(COOKIES.access);
  jar.delete(COOKIES.refresh);
  jar.delete(COOKIES.mfaChallenge);
}

/**
 * Single-flight refresh.
 *
 * The API rotates refresh tokens and treats a second use of an already-rotated
 * token as theft (the whole session is revoked). Parallel requests from one
 * browser — page loads, prefetches, server actions — can all arrive with the
 * same expired access token, so every refresh for a given refresh token shares
 * one API call, and its result is reused for a short grace window by requests
 * that were already in flight with the old cookie.
 *
 * This state is per server process. Running several staff-app instances needs
 * sticky sessions or a shared store (e.g. Redis) for the same guarantee.
 */
const GRACE_MS = 30_000;

/**
 * `rejected`: the refresh token is invalid, expired or revoked — sign in again.
 * `unavailable`: rate limit, server error or network failure — keep the session and retry later.
 */
export type RefreshResult = { status: "ok"; tokens: TokenResponse } | { status: "rejected" } | { status: "unavailable" };

const inflight = new Map<string, { at: number; result: Promise<RefreshResult> }>();

type Fetch = typeof fetch;

export function refreshTokens(
  refreshToken: string,
  fetchImpl: Fetch = fetch,
  now = Date.now(),
  forwarded: Record<string, string> = {},
): Promise<RefreshResult> {
  for (const [key, entry] of inflight) if (now - entry.at > GRACE_MS) inflight.delete(key);
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const hit = inflight.get(key);
  if (hit) return hit.result;
  const result: Promise<RefreshResult> = fetchImpl(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { ...forwarded, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  })
    .then(async (res): Promise<RefreshResult> => {
      if (res.ok) return { status: "ok", tokens: (await res.json()) as TokenResponse };
      return res.status === 429 || res.status >= 500 ? { status: "unavailable" } : { status: "rejected" };
    })
    .catch((): RefreshResult => ({ status: "unavailable" }));
  inflight.set(key, { at: now, result });
  // Only successes and definitive rejections are shared; a transient failure may be retried at once.
  void result.then((r) => {
    if (r.status === "unavailable" && inflight.get(key)?.result === result) inflight.delete(key);
  });
  return result;
}

/** Test hook. */
export function resetRefreshCache(): void {
  inflight.clear();
}
