import { AgentApi, ApiRefusedError, TransientApiError } from "./api";
import { ConfigError } from "./config";

const FACILITY = "11111111-1111-4111-8111-111111111111";
const JOB = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  attempt: 1,
  ticket: "A-007",
  serviceName: "Consultation",
  facilityName: "Clinic",
  issuedAt: "2026-11-04T01:30:00.000Z",
  instructions: "Please take a seat.",
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch that answers from a list and records each call. */
function fakeFetch(answers: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : {} });
    const answer = answers.shift() ?? { status: 500 };
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const make = (answers: Array<{ status: number; body?: unknown }>) => {
  const { calls, impl } = fakeFetch(answers);
  const api = new AgentApi({
    baseUrl: "https://clinic.example.ph/api/v1",
    email: "agent@x.ph",
    password: "secret-pass",
    facilityId: FACILITY,
    fetchImpl: impl,
  });
  return { api, calls };
};

describe("AgentApi", () => {
  it("signs in once, then sends the facility and the token with every call, and the password never again", async () => {
    const { api, calls } = make([
      { status: 200, body: { accessToken: "tok-1" } },
      { status: 200, body: { job: JOB } },
      { status: 200, body: { job: null } },
    ]);
    expect(await api.claim("front-1")).toEqual({ job: JOB });
    expect(await api.claim("front-1")).toEqual({ job: null });

    expect(calls.map((c) => c.url)).toEqual([
      "https://clinic.example.ph/api/v1/auth/login",
      "https://clinic.example.ph/api/v1/kiosk/print/claim",
      "https://clinic.example.ph/api/v1/kiosk/print/claim",
    ]);
    expect(calls[0]?.body).toMatchObject({ email: "agent@x.ph", password: "secret-pass" });
    for (const call of calls.slice(1)) {
      expect(call.headers).toMatchObject({ authorization: "Bearer tok-1", "x-facility-id": FACILITY });
      expect(JSON.stringify(call.body)).not.toContain("secret-pass");
    }
  });

  it("signs in again when the session ended, once", async () => {
    const { api, calls } = make([
      { status: 200, body: { accessToken: "tok-1" } },
      { status: 401 },
      { status: 200, body: { accessToken: "tok-2" } },
      { status: 200, body: { job: null } },
    ]);
    expect(await api.claim("front-1")).toEqual({ job: null });
    expect(calls[3]?.headers.authorization).toBe("Bearer tok-2");
  });

  it("stops for good when the account is not set up for it", async () => {
    await expect(make([{ status: 401 }]).api.claim("front-1")).rejects.toBeInstanceOf(ConfigError);
    await expect(make([{ status: 200, body: { status: "mfa_required", challengeToken: "x" } }]).api.claim("front-1")).rejects.toThrow(/two-step/);
  });

  it("treats a busy or unreachable API as something to retry, and a refused request as just that request", async () => {
    await expect(make([{ status: 429 }]).api.claim("front-1")).rejects.toBeInstanceOf(TransientApiError);
    await expect(make([{ status: 200, body: { accessToken: "t" } }, { status: 503 }]).api.claim("front-1")).rejects.toBeInstanceOf(TransientApiError);
    await expect(make([{ status: 200, body: { accessToken: "t" } }, { status: 404 }]).api.claim("nope-9")).rejects.toBeInstanceOf(ApiRefusedError);
    const offline = new AgentApi({
      baseUrl: "https://x.example",
      email: "a@x.ph",
      password: "p",
      facilityId: FACILITY,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(offline.claim("front-1")).rejects.toBeInstanceOf(TransientApiError);
  });

  it("does not hammer a sign-in the API turned away: it waits for the Retry-After, or a short while, before trying again", async () => {
    let clock = 1_000_000;
    const answers: Array<{ status: number; headers?: Record<string, string>; body?: unknown }> = [
      { status: 429, headers: { "retry-after": "20" } },
      { status: 200, body: { accessToken: "t" } },
      { status: 200, body: { job: null } },
    ];
    let signIns = 0;
    const api = new AgentApi({
      baseUrl: "https://x.example",
      email: "a@x.ph",
      password: "p",
      facilityId: FACILITY,
      now: () => clock,
      fetchImpl: (async (url: string) => {
        if (String(url).endsWith("/auth/login")) signIns += 1;
        const answer = answers.shift() ?? { status: 500 };
        return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { "content-type": "application/json", ...answer.headers } });
      }) as unknown as typeof fetch,
    });
    await expect(api.claim("front-1")).rejects.toBeInstanceOf(TransientApiError);
    expect(signIns).toBe(1);
    // The next polls, inside the 20 seconds the API asked for, do not touch the API at all.
    clock += 5_000;
    await expect(api.claim("front-1")).rejects.toThrow(/Waiting before signing in again/);
    clock += 10_000;
    await expect(api.claim("front-1")).rejects.toThrow(/Waiting before signing in again/);
    expect(signIns).toBe(1);
    // After it, the agent signs in and carries on.
    clock += 6_000;
    expect(await api.claim("front-1")).toEqual({ job: null });
    expect(signIns).toBe(2);
  });

  it("reads the printer settings with the facility header, and checks their shape", async () => {
    const answer = {
      timeZone: "Asia/Manila",
      kiosks: [{ code: "front-1", printsTickets: true, connection: "network", host: "192.168.1.50", port: 9100, paperMm: 80 }],
    };
    const { api, calls } = make([
      { status: 200, body: { accessToken: "tok-1" } },
      { status: 200, body: answer },
    ]);
    expect(await api.config()).toEqual(answer);
    expect(calls[1]).toMatchObject({
      url: "https://clinic.example.ph/api/v1/kiosk/print/config",
      headers: { authorization: "Bearer tok-1", "x-facility-id": FACILITY },
    });

    const bad = make([
      { status: 200, body: { accessToken: "t" } },
      { status: 200, body: { timeZone: "Asia/Manila", kiosks: [{ code: "front-1", paperMm: 70 }] } },
    ]);
    await expect(bad.api.config()).rejects.toBeInstanceOf(TransientApiError);
  });

  it("finds its facility itself when the account works at exactly one, and asks the operator otherwise", async () => {
    const ID = "22222222-2222-4222-8222-222222222222";
    const noFacility = (answers: Array<{ status: number; body?: unknown }>) => {
      const { calls, impl } = fakeFetch(answers);
      const api = new AgentApi({ baseUrl: "https://clinic.example.ph/api/v1", email: "agent@x.ph", password: "p", facilityId: null, fetchImpl: impl });
      return { api, calls };
    };
    const one = noFacility([
      { status: 200, body: { accessToken: "tok" } },
      { status: 200, body: [{ id: ID }] },
      { status: 200, body: { timeZone: "Asia/Manila", kiosks: [] } },
    ]);
    await one.api.config();
    // The lookup carries no facility header; the settings call carries the one found.
    expect(one.calls[1]?.url).toBe("https://clinic.example.ph/api/v1/auth/me/facilities");
    expect(one.calls[1]?.headers["x-facility-id"]).toBeUndefined();
    expect(one.calls[2]?.headers["x-facility-id"]).toBe(ID);

    await expect(
      noFacility([
        { status: 200, body: { accessToken: "t" } },
        { status: 200, body: [{ id: ID }, { id: FACILITY }] },
      ]).api.resolveFacility(),
    ).rejects.toThrow(/FACILITY_ID/);
    await expect(
      noFacility([
        { status: 200, body: { accessToken: "t" } },
        { status: 200, body: [] },
      ]).api.resolveFacility(),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("does not trust a claim answer that is not a ticket", async () => {
    const { api } = make([
      { status: 200, body: { accessToken: "t" } },
      { status: 200, body: { job: { ...JOB, ticket: "\u001b@ROOT" } } },
      { status: 200, body: { job: { ...JOB, instructions: "" } } },
      { status: 200, body: { unexpected: true } },
    ]);
    expect(await api.claim("front-1")).toEqual({ invalid: JOB.id });
    expect(await api.claim("front-1")).toEqual({ invalid: JOB.id });
    expect(await api.claim("front-1")).toEqual({ invalid: null });
  });

  it("reports results and printer state to the right places", async () => {
    const { api, calls } = make([
      { status: 200, body: { accessToken: "t" } },
      { status: 200, body: { status: "printed" } },
      { status: 200, body: { status: "queued" } },
      { status: 200, body: { ok: true } },
    ]);
    await api.report(JOB.id, { outcome: "printed" });
    await api.report(JOB.id, { outcome: "failed", error: "offline", retry: true });
    await api.heartbeat("front-1", "paper_out");
    expect(calls.slice(1).map((c) => [c.url.replace("https://clinic.example.ph/api/v1", ""), c.body])).toEqual([
      [`/kiosk/print/jobs/${JOB.id}/result`, { outcome: "printed" }],
      [`/kiosk/print/jobs/${JOB.id}/result`, { outcome: "failed", error: "offline", retry: true }],
      ["/kiosk/print/heartbeat", { deviceCode: "front-1", printerStatus: "paper_out" }],
    ]);
  });
});
