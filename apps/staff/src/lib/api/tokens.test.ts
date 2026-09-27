import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIES } from "./config";
import { clearSessionCookies, refreshTokens, resetRefreshCache, writeTokenCookies } from "./tokens";
import type { TokenResponse } from "./types";

const tokens: TokenResponse = {
  status: "authenticated",
  accessToken: "access-2",
  tokenType: "Bearer",
  expiresIn: 900,
  refreshToken: "refresh-2-xxxxxxxxxxxxxxxxxxxx",
  refreshTokenExpiresAt: "2026-10-11T00:00:00.000Z",
  organizationId: "org",
};

const ok = () => new Response(JSON.stringify(tokens), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => resetRefreshCache());

describe("refreshTokens", () => {
  it("shares one API call between concurrent refreshes of the same token (the API revokes on reuse)", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const results = await Promise.all(Array.from({ length: 6 }, () => refreshTokens("refresh-1-xxxxxxxxxxxxxxxxxxxx", fetchImpl)));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === "ok" && r.tokens.accessToken === "access-2")).toBe(true);
  });

  it("reuses the result for requests still carrying the old cookie within the grace window", async () => {
    const fetchImpl = vi.fn(async () => ok());
    await refreshTokens("refresh-1-xxxxxxxxxxxxxxxxxxxx", fetchImpl, 1_000);
    await refreshTokens("refresh-1-xxxxxxxxxxxxxxxxxxxx", fetchImpl, 20_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await refreshTokens("refresh-1-xxxxxxxxxxxxxxxxxxxx", fetchImpl, 40_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("signs out only when the API rejects the token", async () => {
    expect(await refreshTokens("revoked-xxxxxxxxxxxxxxxxxxxxxx", async () => new Response("{}", { status: 401 }))).toEqual({ status: "rejected" });
  });

  it.each([
    ["rate limited", async () => new Response("{}", { status: 429 })],
    ["server error", async () => new Response("{}", { status: 503 })],
    [
      "unreachable",
      async () => {
        throw new Error("ECONNREFUSED");
      },
    ],
  ])("keeps the session when the API is %s, and retries on the next request", async (_name, failing) => {
    expect(await refreshTokens("transient-xxxxxxxxxxxxxxxxxxxx", failing as typeof fetch)).toEqual({ status: "unavailable" });
    await Promise.resolve();
    const retry = vi.fn(async () => ok());
    expect((await refreshTokens("transient-xxxxxxxxxxxxxxxxxxxx", retry)).status).toBe("ok");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("forwards the client's identity to the API", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => ok());
    await refreshTokens("forward-xxxxxxxxxxxxxxxxxxxxxx", fetchImpl as unknown as typeof fetch, Date.now(), { "x-forwarded-for": "203.0.113.7" });
    expect((fetchImpl.mock.calls[0]![1].headers as Record<string, string>)["x-forwarded-for"]).toBe("203.0.113.7");
  });
});

describe("session cookies", () => {
  it("writes httpOnly cookies; access expires just before the token, refresh at its own expiry and SameSite=Strict", () => {
    const set = vi.fn();
    writeTokenCookies({ set, delete: vi.fn() }, tokens);
    const byName = Object.fromEntries(set.mock.calls.map(([name, value, options]) => [name, { value, options }]));
    expect(byName[COOKIES.access]).toMatchObject({ value: "access-2", options: { httpOnly: true, maxAge: 870, sameSite: "lax", path: "/" } });
    expect(byName[COOKIES.refresh].options).toMatchObject({ httpOnly: true, sameSite: "strict", expires: new Date(tokens.refreshTokenExpiresAt) });
  });

  it("clears access, refresh and MFA challenge cookies on sign-out", () => {
    const del = vi.fn();
    clearSessionCookies({ set: vi.fn(), delete: del });
    expect(del.mock.calls.map(([n]) => n).sort()).toEqual([COOKIES.access, COOKIES.mfaChallenge, COOKIES.refresh].sort());
  });
});
