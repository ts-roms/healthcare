import { PlatformClient } from "./api-client";
import { loadConfig } from "./config";

const INSTRUMENT = "83de7304-8abd-4138-a58d-7bc4d779e18f";
const base = {
  GATEWAY_API_URL: "https://api.example.ph/api/v1/",
  GATEWAY_EMAIL: "gateway@example.ph",
  GATEWAY_PASSWORD: "secret",
  GATEWAY_INSTRUMENTS: JSON.stringify([{ instrumentId: INSTRUMENT, protocol: "hl7v2", port: 5001 }]),
};

describe("gateway configuration", () => {
  it("reads the API, account and instruments", () => {
    expect(loadConfig(base)).toEqual({
      apiUrl: "https://api.example.ph/api/v1",
      email: "gateway@example.ph",
      password: "secret",
      organizationId: undefined,
      instruments: [{ instrumentId: INSTRUMENT, protocol: "hl7v2", port: 5001, host: "0.0.0.0" }],
    });
  });

  it("refuses incomplete or conflicting settings", () => {
    expect(() => loadConfig({ ...base, GATEWAY_PASSWORD: "" })).toThrow("GATEWAY_PASSWORD is required");
    expect(() => loadConfig({ ...base, GATEWAY_INSTRUMENTS: "[]" })).toThrow("at least one instrument");
    expect(() => loadConfig({ ...base, GATEWAY_INSTRUMENTS: JSON.stringify([{ instrumentId: INSTRUMENT, protocol: "lis2", port: 5001 }]) })).toThrow(
      "hl7v2 or astm",
    );
    expect(() =>
      loadConfig({
        ...base,
        GATEWAY_INSTRUMENTS: JSON.stringify([
          { instrumentId: INSTRUMENT, protocol: "hl7v2", port: 5001 },
          { instrumentId: INSTRUMENT, protocol: "astm", port: 5001 },
        ]),
      }),
    ).toThrow("used twice");
  });
});

describe("platform client", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const tokens = (n: number) => ({ status: "authenticated", accessToken: `access-${n}`, refreshToken: `refresh-${n}` });

  it("signs in, posts the message, and refreshes the session once when the token expired", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const responses = [json(200, tokens(1)), json(200, { duplicate: false }), json(401, {}), json(200, tokens(2)), json(200, { duplicate: true })];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>)["authorization"] });
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const client = new PlatformClient({ apiUrl: "https://api.example.ph/api/v1", email: "g@example.ph", password: "p" }, fetchFn);
    await expect(client.submit(INSTRUMENT, "MSH|…")).resolves.toEqual({ kind: "accepted", duplicate: false });
    await expect(client.submit(INSTRUMENT, "MSH|…")).resolves.toEqual({ kind: "accepted", duplicate: true });
    expect(calls.map((c) => c.url.replace("https://api.example.ph/api/v1", ""))).toEqual([
      "/auth/login",
      `/laboratory/instruments/${INSTRUMENT}/messages`,
      `/laboratory/instruments/${INSTRUMENT}/messages`,
      "/auth/refresh",
      `/laboratory/instruments/${INSTRUMENT}/messages`,
    ]);
    expect(calls[4]!.auth).toBe("Bearer access-2");
  });

  it("tells a refusal (the platform could not read it) from a delivery failure", async () => {
    const refusing = new PlatformClient({ apiUrl: "https://x/api/v1", email: "g", password: "p" }, (async (url: string) =>
      url.endsWith("/auth/login") ? json(200, tokens(1)) : json(422, { error: { code: "instrument_message_unreadable" } })) as unknown as typeof fetch);
    await expect(refusing.submit(INSTRUMENT, "x")).resolves.toEqual({ kind: "refused", code: "instrument_message_unreadable" });
    const down = new PlatformClient({ apiUrl: "https://x/api/v1", email: "g", password: "p" }, (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(down.submit(INSTRUMENT, "x")).resolves.toEqual({ kind: "failed", reason: "fetch failed" });
    const mfa = new PlatformClient({ apiUrl: "https://x/api/v1", email: "g", password: "p" }, (async () =>
      json(200, { status: "mfa_required" })) as unknown as typeof fetch);
    await expect(mfa.submit(INSTRUMENT, "x")).resolves.toMatchObject({ kind: "failed", reason: expect.stringContaining("mfa_required") });
  });
});
