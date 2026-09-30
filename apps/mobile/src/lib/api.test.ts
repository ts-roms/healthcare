import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, NetworkError, type SessionStore } from "./api";
import type { StoredSession } from "./types";

const FUTURE = "2099-01-01T00:00:00Z";
const session = (n: number, refreshTokenExpiresAt = FUTURE): StoredSession => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  refreshTokenExpiresAt,
});
const tokens = (n: number) => ({ status: "authenticated", tokenType: "Bearer", expiresIn: 900, ...session(n) });
const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function memoryStore(initial: StoredSession | null = null): SessionStore & { current: StoredSession | null } {
  const store = {
    current: initial,
    load: async () => store.current,
    save: async (s: StoredSession) => void (store.current = s),
    clear: async () => void (store.current = null),
  };
  return store;
}

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, initial: StoredSession | null = session(1)) {
  const store = memoryStore(initial);
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const onSignedOut = vi.fn();
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ path: url.replace("https://api.test/api/v1", ""), init });
    return handler(url.replace("https://api.test/api/v1", ""), init);
  }) as unknown as typeof fetch;
  const api = createApiClient({
    baseUrl: "https://api.test/api/v1/",
    organizationCode: "demo",
    store,
    fetch: fetchImpl,
    onSignedOut,
    now: () => Date.parse("2026-06-01T00:00:00Z"),
  });
  return { api, store, calls, onSignedOut };
}
const auth = (init: RequestInit) => (init.headers as Record<string, string>)["authorization"];

describe("sign-in", () => {
  it("keeps the tokens when the password is enough, and sends the organization and a trimmed email", async () => {
    const { api, store, calls } = setup(() => json(tokens(1)), null);
    await expect(api.login(" juan@example.ph ", "secret")).resolves.toEqual({ kind: "signed_in" });
    expect(store.current).toEqual(session(1));
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ organizationCode: "demo", email: "juan@example.ph", password: "secret" });
    expect(auth(calls[0]!.init)).toBeUndefined();
  });

  it("asks for the code when two-step verification is on, and finishes with it", async () => {
    const { api, store } = setup(
      (path) => (path === "/portal/auth/login" ? json({ status: "mfa_required", challengeToken: "challenge" }) : json(tokens(2))),
      null,
    );
    await expect(api.login("a@b.ph", "pw")).resolves.toEqual({ kind: "mfa_required", challengeToken: "challenge" });
    expect(store.current).toBeNull();
    await api.verifyMfa("challenge", " 123456 ");
    expect(store.current).toEqual(session(2));
  });

  it("reports the API's own error code and message", async () => {
    const { api } = setup(() => json({ error: { code: "invalid_credentials", message: "Invalid email or password" } }, 401), null);
    await expect(api.login("a@b.ph", "bad")).rejects.toMatchObject({ status: 401, code: "invalid_credentials", message: "Invalid email or password" });
  });
});

describe("requests", () => {
  it("sends the access token and reads the answer, including an empty one", async () => {
    const { api, calls } = setup((path) => (path === "/portal/x" ? json({ ok: true }) : json(null, 204)));
    await expect(api.get("/portal/x")).resolves.toEqual({ ok: true });
    await expect(api.post("/portal/y")).resolves.toBeUndefined();
    expect(auth(calls[0]!.init)).toBe("Bearer access-1");
  });

  it("refreshes once on 401 and repeats the request with the new token", async () => {
    let served = 0;
    const { api, store, calls } = setup((path, init) => {
      if (path === "/portal/auth/refresh") return json(tokens(2));
      served += 1;
      return auth(init) === "Bearer access-2" ? json({ n: served }) : json({ error: { code: "unauthenticated", message: "no" } }, 401);
    });
    await expect(api.get("/portal/me")).resolves.toEqual({ n: 2 });
    expect(store.current).toEqual(session(2));
    expect(calls.map((c) => c.path)).toEqual(["/portal/me", "/portal/auth/refresh", "/portal/me"]);
  });

  it("shares one refresh between requests that fail together (the refresh token rotates)", async () => {
    let refreshes = 0;
    const { api } = setup((path, init) => {
      if (path === "/portal/auth/refresh") {
        refreshes += 1;
        return json(tokens(2));
      }
      return auth(init) === "Bearer access-2" ? json({}) : json({}, 401);
    });
    await Promise.all([api.get("/portal/a"), api.get("/portal/b"), api.get("/portal/c")]);
    expect(refreshes).toBe(1);
  });

  it("ends the session when the API refuses the refresh, or the refresh token has expired", async () => {
    const refused = setup((path) => (path === "/portal/auth/refresh" ? json({}, 401) : json({}, 401)));
    await expect(refused.api.get("/portal/me")).rejects.toMatchObject({ code: "session_ended" });
    expect(refused.store.current).toBeNull();
    expect(refused.onSignedOut).toHaveBeenCalledTimes(1);

    const expired = setup(() => json({}, 401), session(1, "2026-01-01T00:00:00Z"));
    await expect(expired.api.get("/portal/me")).rejects.toMatchObject({ code: "session_ended" });
    expect(expired.calls.map((c) => c.path)).toEqual(["/portal/me"]);
  });

  it("keeps the session when the network fails, and asks to sign in when there is none", async () => {
    const offline = setup(() => {
      throw new TypeError("Network request failed");
    });
    await expect(offline.api.get("/portal/me")).rejects.toBeInstanceOf(NetworkError);
    expect(offline.store.current).toEqual(session(1));
    expect(offline.onSignedOut).not.toHaveBeenCalled();

    const none = setup(() => json({}), null);
    await expect(none.api.get("/portal/me")).rejects.toMatchObject({ code: "not_signed_in" });
    expect(none.onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("turns other errors into ApiError with the API's code", async () => {
    const { api } = setup(() => json({ error: { code: "too_many_push_devices", message: "Remove one first." } }, 422));
    const error = await api.post("/portal/push/mobile-devices").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "too_many_push_devices" });
  });
});

describe("sign-out", () => {
  it("clears the session even when the server cannot be reached", async () => {
    const { api, store } = setup(() => {
      throw new TypeError("offline");
    });
    await api.logout();
    expect(store.current).toBeNull();
  });
});
