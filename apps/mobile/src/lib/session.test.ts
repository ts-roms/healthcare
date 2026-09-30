import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, patientMessage, SessionEndedError } from "./api-error";
import { PatientSession, type SessionState, type TokenStore } from "./session";

/**
 * A stand-in for the MyHealth API that behaves as the real one did in the native-client trace
 * (docs/architecture/mobile-app.md): refresh tokens rotate, a reused one revokes the session, logout ends it.
 */
class FakeApi {
  refreshCalls = 0;
  revoked = false;
  current = "rt-1";
  previous: string | null = null;
  access = "at-1";
  mfa = false;
  /** Status the next data request answers with (then back to 200). */
  nextDataStatus: number | null = null;
  requests: Array<{ path: string; authorization?: string; body?: unknown; headers: Record<string, string> }> = [];
  private n = 1;

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input).replace("https://api.test/api/v1", "");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.requests.push({ path, authorization: headers.authorization, body, headers });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    const error = (status: number, code: string, message: string) => json(status, { error: { code, message, requestId: "abcdef1234" } });
    await Promise.resolve();

    if (path === "/portal/auth/login") {
      if (body.password !== "right") return error(401, "invalid_credentials", "Invalid email or password");
      return this.mfa ? json(200, { status: "mfa_required", challengeToken: "challenge" }) : json(200, this.issue());
    }
    if (path === "/portal/auth/mfa/verify") {
      if (body.code !== "123456") return error(401, "invalid_mfa_code", "The code is not right");
      return json(200, this.issue());
    }
    if (path === "/portal/auth/refresh") {
      this.refreshCalls += 1;
      if (this.revoked) return error(401, "invalid_token", "Invalid or expired token");
      if (body.refreshToken === this.previous) {
        this.revoked = true;
        return error(401, "invalid_token", "Invalid or expired token");
      }
      if (body.refreshToken !== this.current) return error(401, "invalid_token", "Invalid or expired token");
      return json(200, this.issue());
    }
    if (path === "/portal/auth/logout") {
      this.revoked = true;
      return new Response(null, { status: 204 });
    }
    if (this.revoked || headers.authorization !== `Bearer ${this.access}`) return error(401, "session_ended", "Your session has ended. Sign in again.");
    if (this.nextDataStatus) {
      const status = this.nextDataStatus;
      this.nextDataStatus = null;
      return error(status, status === 422 ? "invalid_mfa_code" : "failed", "Refused");
    }
    if (path.endsWith("/remove")) return new Response(null, { status: 204 });
    return json(200, { path, method: init?.method ?? "GET", body });
  };

  private issue() {
    this.n += 1;
    this.previous = this.current;
    this.current = `rt-${this.n}`;
    this.access = `at-${this.n}`;
    return {
      status: "authenticated",
      accessToken: this.access,
      tokenType: "Bearer",
      expiresIn: 900,
      refreshToken: this.current,
      refreshTokenExpiresAt: "2026-10-14T00:00:00Z",
    };
  }
}

class MemoryStore implements TokenStore {
  value: string | null = null;
  async read() {
    return this.value;
  }
  async write(token: string) {
    this.value = token;
  }
  async clear() {
    this.value = null;
  }
}

let api: FakeApi;
let store: MemoryStore;
let clock: number;
let states: SessionState[];
let session: PatientSession;

beforeEach(() => {
  api = new FakeApi();
  store = new MemoryStore();
  clock = 1_000_000;
  states = [];
  session = new PatientSession({ baseUrl: "https://api.test/api/v1", organizationCode: "demo", store, fetch: api.fetch, now: () => clock });
  session.subscribe((s) => states.push(s));
});

describe("sign-in", () => {
  it("sends the organization code, keeps the refresh token in the store and the access token in memory", async () => {
    expect(await session.signIn("ana@example.com", "right")).toBe("signed_in");
    expect(api.requests[0]!.body).toEqual({ organizationCode: "demo", email: "ana@example.com", password: "right" });
    expect(store.value).toBe(api.current);
    expect(session.signedIn).toBe(true);
    expect(states).toEqual([{ status: "signed_in" }]);
  });

  it("asks for the code when the account uses two-step verification, then signs in with it", async () => {
    api.mfa = true;
    expect(await session.signIn("ana@example.com", "right")).toBe("code_required");
    expect(store.value).toBeNull();
    await expect(session.verifyCode("000000")).rejects.toMatchObject({ status: 401, code: "invalid_mfa_code" });
    await session.verifyCode("123456");
    expect(api.requests.at(-1)!.body).toEqual({ challengeToken: "challenge", code: "123456" });
    expect(session.signedIn).toBe(true);
  });

  it("refuses a code without a password step first", async () => {
    await expect(session.verifyCode("123456")).rejects.toMatchObject({ code: "challenge_missing" });
  });

  it("reports a wrong password without storing anything", async () => {
    await expect(session.signIn("ana@example.com", "wrong")).rejects.toBeInstanceOf(ApiError);
    expect(store.value).toBeNull();
    expect(session.signedIn).toBe(false);
  });
});

describe("requests", () => {
  beforeEach(async () => {
    await session.signIn("ana@example.com", "right");
  });

  it("sends only the bearer token — no acting-for header", async () => {
    await session.get("/portal/results");
    const request = api.requests.at(-1)!;
    expect(request.authorization).toBe(`Bearer ${api.access}`);
    expect(Object.keys(request.headers).map((h) => h.toLowerCase())).not.toContain("x-acting-for");
  });

  it("refreshes before the access token expires", async () => {
    clock += 900_000 - 20_000; // inside the 30-second margin
    await session.get("/portal/results");
    expect(api.refreshCalls).toBe(1);
    expect(store.value).toBe(api.current);
  });

  it("shares one refresh between concurrent requests (a second use of the old token would revoke the session)", async () => {
    clock += 901_000;
    await Promise.all([session.get("/portal/results"), session.get("/portal/me"), session.get("/portal/results/trend?testId=x")]);
    expect(api.refreshCalls).toBe(1);
    expect(api.revoked).toBe(false);
  });

  it("retries once after a 401 with a refreshed token", async () => {
    api.access = "rotated-elsewhere"; // the API no longer accepts the token this device holds
    await expect(session.get("/portal/results")).resolves.toMatchObject({ path: "/portal/results" });
    expect(api.refreshCalls).toBe(1);
  });

  it("keeps the session on a 422, 403 or 500 — only a refused session signs the patient out", async () => {
    for (const status of [422, 403, 500]) {
      api.nextDataStatus = status;
      await expect(session.get("/portal/results")).rejects.toMatchObject({ status });
    }
    expect(session.signedIn).toBe(true);
    expect(store.value).not.toBeNull();
  });

  it("signs out when the API refuses the refresh (e.g. the token was reused or the clinic disabled access)", async () => {
    api.revoked = true;
    await expect(session.get("/portal/results")).rejects.toBeInstanceOf(SessionEndedError);
    expect(session.signedIn).toBe(false);
    expect(store.value).toBeNull();
    expect(states.at(-1)).toEqual({ status: "signed_out", reason: "session_ended" });
  });

  it("keeps the stored session when the refresh cannot reach the API", async () => {
    clock += 901_000;
    const offline = new PatientSession({
      baseUrl: "https://api.test/api/v1",
      organizationCode: "demo",
      store,
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
      now: () => clock,
    });
    await expect(offline.get("/portal/results")).rejects.toBeInstanceOf(TypeError);
    expect(store.value).toBe(api.current);
  });
});

describe("posts (this phone's notifications)", () => {
  beforeEach(async () => {
    await session.signIn("ana@example.com", "right");
  });

  it("sends a JSON body with the bearer token, and reads an empty answer", async () => {
    await expect(session.post("/portal/push/mobile-devices", { token: "t", platform: "ios" })).resolves.toEqual({
      path: "/portal/push/mobile-devices",
      method: "POST",
      body: { token: "t", platform: "ios" },
    });
    expect(api.requests.at(-1)!.headers["content-type"]).toBe("application/json");
    await expect(session.post("/portal/push/subscriptions/d1/remove")).resolves.toBeUndefined();
    expect(api.requests.at(-1)!.body).toEqual({});
  });

  it("refreshes and retries after a 401 like a read, and signs out when the session is refused", async () => {
    api.access = "rotated-elsewhere";
    await expect(session.post("/portal/push/test")).resolves.toMatchObject({ method: "POST" });
    expect(api.refreshCalls).toBe(1);
    api.revoked = true;
    await expect(session.post("/portal/push/test")).rejects.toBeInstanceOf(SessionEndedError);
    expect(session.signedIn).toBe(false);
  });
});

describe("restore and sign-out", () => {
  it("resumes a stored session at app start", async () => {
    await session.signIn("ana@example.com", "right");
    const next = new PatientSession({ baseUrl: "https://api.test/api/v1", organizationCode: "demo", store, fetch: api.fetch, now: () => clock });
    expect(await next.restore()).toBe(true);
    expect(next.signedIn).toBe(true);
  });

  it("starts signed out when nothing is stored or the API refuses the stored session", async () => {
    expect(await session.restore()).toBe(false);
    store.value = "stale";
    expect(await session.restore()).toBe(false);
    expect(store.value).toBeNull();
  });

  it("ends the session at the API and forgets it on the device", async () => {
    await session.signIn("ana@example.com", "right");
    const token = api.access;
    await session.signOut();
    expect(api.requests.at(-1)).toMatchObject({ path: "/portal/auth/logout", authorization: `Bearer ${token}` });
    expect(store.value).toBeNull();
    expect(states.at(-1)).toEqual({ status: "signed_out", reason: "signed_out" });
  });

  it("forgets the session on the device even when the API cannot be reached", async () => {
    await session.signIn("ana@example.com", "right");
    const offline = new PatientSession({
      baseUrl: "https://api.test/api/v1",
      organizationCode: "demo",
      store,
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
    });
    await offline.signOut();
    expect(store.value).toBeNull();
  });
});

it("words errors for patients as MyHealth on the web does", () => {
  expect(patientMessage(new TypeError("Network request failed"))).toBe("We couldn't reach MyHealth. Check your connection and try again.");
  expect(patientMessage(new ApiError(429, "rate_limited", "x"))).toBe("Too many attempts. Wait a minute, then try again.");
  expect(patientMessage(new ApiError(401, "invalid_credentials", "Invalid email or password", "abcdef1234"))).toBe("Invalid email or password (ref abcdef12)");
  expect(patientMessage(new ApiError(503, "unavailable", "x", "abcdef1234"))).toBe(
    "Something went wrong on our side. Try again in a few minutes. (ref abcdef12)",
  );
  expect(patientMessage(new SessionEndedError())).toBe("Your session has ended. Sign in again.");
});
