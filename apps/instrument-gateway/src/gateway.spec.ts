import { type AddressInfo, connect } from "node:net";
import { mllpFrame } from "@healthcare/interoperability/instruments";
import { PlatformClient } from "./api-client";
import { loadConfig } from "./config";
import { hl7Listener } from "./listeners";

const INSTRUMENT = "83de7304-8abd-4138-a58d-7bc4d779e18f";
const base = {
  GATEWAY_API_URL: "https://api.example.ph/api/v1/",
  GATEWAY_EMAIL: "gateway@example.ph",
  GATEWAY_PASSWORD: "secret",
  GATEWAY_INSTRUMENTS: JSON.stringify([{ instrumentId: INSTRUMENT, protocol: "hl7v2", port: 5001, allowedPeers: ["192.168.10.21", "::ffff:192.168.10.22"] }]),
};

describe("gateway configuration", () => {
  it("reads the API, account and instruments", () => {
    expect(loadConfig(base)).toEqual({
      apiUrl: "https://api.example.ph/api/v1",
      email: "gateway@example.ph",
      password: "secret",
      organizationId: undefined,
      instruments: [{ instrumentId: INSTRUMENT, protocol: "hl7v2", port: 5001, host: "0.0.0.0", allowedPeers: ["192.168.10.21", "192.168.10.22"] }],
    });
  });

  it("requires the analyzer's addresses, https to the API, and reads the password from a file when given", () => {
    const one = (entry: object) => JSON.stringify([{ instrumentId: INSTRUMENT, protocol: "hl7v2", port: 5001, ...entry }]);
    expect(() => loadConfig({ ...base, GATEWAY_INSTRUMENTS: one({}) })).toThrow("allowedPeers");
    expect(() => loadConfig({ ...base, GATEWAY_INSTRUMENTS: one({ allowedPeers: ["analyzer.lab"] }) })).toThrow("allowedPeers");
    expect(() => loadConfig({ ...base, GATEWAY_API_URL: "http://api.example.ph/api/v1" })).toThrow("must use https");
    expect(loadConfig({ ...base, GATEWAY_API_URL: "http://127.0.0.1:3333/api/v1" }).apiUrl).toBe("http://127.0.0.1:3333/api/v1");
    const fromFile = loadConfig({ ...base, GATEWAY_PASSWORD: "", GATEWAY_PASSWORD_FILE: "/run/secrets/gateway" }, (path) => {
      expect(path).toBe("/run/secrets/gateway");
      return "from-file\n";
    });
    expect(fromFile.password).toBe("from-file");
    expect(() => loadConfig({ ...base, GATEWAY_PASSWORD_FILE: "/empty" }, () => "  ")).toThrow("GATEWAY_PASSWORD_FILE is empty");
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
          { instrumentId: INSTRUMENT, protocol: "hl7v2", port: 5001, allowedPeers: ["10.0.0.1"] },
          { instrumentId: INSTRUMENT, protocol: "astm", port: 5001, allowedPeers: ["10.0.0.1"] },
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
    const responses = [
      json(200, tokens(1)),
      json(200, { permissions: ["lab.instrument.message.submit"] }),
      json(200, { duplicate: false }),
      json(401, {}),
      json(200, tokens(2)),
      json(200, { duplicate: true }),
    ];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>)["authorization"] });
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const client = new PlatformClient({ apiUrl: "https://api.example.ph/api/v1", email: "g@example.ph", password: "p" }, fetchFn);
    await expect(client.submit(INSTRUMENT, "MSH|…")).resolves.toEqual({ kind: "accepted", duplicate: false });
    await expect(client.submit(INSTRUMENT, "MSH|…")).resolves.toEqual({ kind: "accepted", duplicate: true });
    expect(calls.map((c) => c.url.replace("https://api.example.ph/api/v1", ""))).toEqual([
      "/auth/login",
      "/auth/me",
      `/laboratory/instruments/${INSTRUMENT}/messages`,
      `/laboratory/instruments/${INSTRUMENT}/messages`,
      "/auth/refresh",
      `/laboratory/instruments/${INSTRUMENT}/messages`,
    ]);
    expect(calls[5]!.auth).toBe("Bearer access-2");
  });

  it("refuses to send as an account that holds more than the gateway's permission", async () => {
    const posted: string[] = [];
    const broad = new PlatformClient({ apiUrl: "https://x/api/v1", email: "admin", password: "p" }, (async (url: string) => {
      if (url.endsWith("/auth/login")) return json(200, tokens(1));
      if (url.endsWith("/auth/me")) return json(200, { permissions: ["lab.instrument.message.submit", "user.manage", "patient.read"] });
      posted.push(url);
      return json(200, { duplicate: false });
    }) as unknown as typeof fetch);
    await expect(broad.submit(INSTRUMENT, "x")).resolves.toMatchObject({ kind: "failed", reason: expect.stringContaining("2 other permission(s)") });
    expect(posted).toEqual([]);
  });

  it("tells a refusal (the platform could not read it) from a delivery failure", async () => {
    const refusing = new PlatformClient({ apiUrl: "https://x/api/v1", email: "g", password: "p" }, (async (url: string) =>
      url.endsWith("/auth/login")
        ? json(200, tokens(1))
        : url.endsWith("/auth/me")
          ? json(200, { permissions: ["lab.instrument.message.submit"] })
          : json(422, { error: { code: "instrument_message_unreadable" } })) as unknown as typeof fetch);
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

describe("listeners", () => {
  const ORU = "MSH|^~\\&|ANALYZER|LAB|LIS|CLINIC|20260930101500||ORU^R01|CTRL-1|P|2.5.1\rOBR|1|2600000123";

  async function exchange(allowedPeers: string[], payload: Buffer): Promise<{ submitted: string[]; events: string[]; reply: Buffer }> {
    const submitted: string[] = [];
    const events: string[] = [];
    const client = {
      submit: async (_id: string, message: string) => (submitted.push(message), { kind: "accepted", duplicate: false }),
    } as unknown as PlatformClient;
    const server = hl7Listener({ instrumentId: INSTRUMENT, protocol: "hl7v2", port: 0, host: "127.0.0.1", allowedPeers }, client, (event) =>
      events.push(event),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const reply = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      const socket = connect(port, "127.0.0.1", () => socket.write(payload));
      socket.on("data", (chunk) => {
        chunks.push(chunk);
        socket.end();
      });
      socket.on("error", () => undefined);
      socket.on("close", () => resolve(Buffer.concat(chunks)));
    });
    await new Promise((resolve) => server.close(resolve));
    return { submitted, events, reply };
  }

  it("closes a connection from an address that is not the analyzer's before reading it", async () => {
    const { submitted, events, reply } = await exchange(["10.20.30.40"], mllpFrame(ORU));
    expect(submitted).toEqual([]);
    expect(events).toContain("hl7.peer-refused");
    expect(reply.length).toBe(0);
  });

  it("takes and acknowledges a message from the analyzer's address", async () => {
    const { submitted, reply } = await exchange(["127.0.0.1"], mllpFrame(ORU));
    expect(submitted).toEqual([ORU]);
    expect(reply.toString("utf8")).toContain("MSA|AA|CTRL-1");
  });
});
