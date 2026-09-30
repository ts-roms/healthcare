import { EXPO_RECEIPTS_BATCH, expoErrorIsConfiguration, expoTokenIsGone, LibraryExpoPushTransport, type ExpoPushMessage } from "./expo-push.transport";

const message = (to: string): ExpoPushMessage => ({
  to,
  title: "MyHealth",
  body: "A message is waiting",
  data: { url: "/messages" },
  sound: "default",
  channelId: "default",
  ttl: 60,
  priority: "high",
});
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("LibraryExpoPushTransport", () => {
  it("posts the messages and maps each ticket, with the access token only when there is one", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return reply({
        data: [
          { status: "ok", id: "t1" },
          { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
        ],
      });
    }) as unknown as typeof fetch;
    const tickets = await new LibraryExpoPushTransport("secret-access-token", fetchImpl).send([message("a"), message("b")]);
    expect(tickets).toEqual([
      { status: "ok", id: "t1" },
      { status: "error", message: "gone", error: "DeviceNotRegistered" },
    ]);
    expect(expoTokenIsGone(tickets[1]!)).toBe(true);
    expect(expoTokenIsGone(tickets[0]!)).toBe(false);
    expect((calls[0]!.init.headers as Record<string, string>)["authorization"]).toBe("Bearer secret-access-token");
    expect(JSON.parse(calls[0]!.init.body as string)).toHaveLength(2);

    await new LibraryExpoPushTransport(undefined, ((_u: string, init: RequestInit) => {
      calls.push({ url: _u, init });
      return reply({ data: [{ status: "ok" }] });
    }) as unknown as typeof fetch).send([message("a")]);
    expect((calls[1]!.init.headers as Record<string, string>)["authorization"]).toBeUndefined();
  });

  it("throws, so the notice is retried, when the service fails or answers in an unexpected shape", async () => {
    await expect(new LibraryExpoPushTransport(undefined, (() => reply({}, 503)) as unknown as typeof fetch).send([message("a")])).rejects.toThrow(/503/);
    await expect(new LibraryExpoPushTransport(undefined, (() => reply({ data: [] })) as unknown as typeof fetch).send([message("a")])).rejects.toThrow(
      /unexpected/,
    );
  });

  it("reads receipts by ticket id and maps each one", async () => {
    let sent: unknown;
    const fetchImpl = ((url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(init.body as string) };
      return reply({
        data: {
          a: { status: "ok" },
          b: { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
          c: { status: "error", details: { error: "InvalidCredentials" } },
        },
      });
    }) as unknown as typeof fetch;
    const receipts = await new LibraryExpoPushTransport(undefined, fetchImpl).receipts(["a", "b", "c", "d"]);
    expect(sent).toEqual({ url: "https://exp.host/--/api/v2/push/getReceipts", body: { ids: ["a", "b", "c", "d"] } });
    expect(receipts).toEqual({
      a: { status: "ok" },
      b: { status: "error", message: "gone", error: "DeviceNotRegistered" },
      c: { status: "error", message: undefined, error: "InvalidCredentials" },
    });
    expect(expoTokenIsGone(receipts["b"]!)).toBe(true);
    expect(expoErrorIsConfiguration(receipts["c"]!)).toBe(true);
    expect(expoErrorIsConfiguration(receipts["b"]!)).toBe(false);
  });

  it("asks for nothing without ids, refuses more than a batch, and throws on a failed answer", async () => {
    const never = (() => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    await expect(new LibraryExpoPushTransport(undefined, never).receipts([])).resolves.toEqual({});
    await expect(new LibraryExpoPushTransport(undefined, never).receipts(Array.from({ length: EXPO_RECEIPTS_BATCH + 1 }, (_, i) => `t${i}`))).rejects.toThrow(
      /1000/,
    );
    await expect(new LibraryExpoPushTransport(undefined, (() => reply({}, 500)) as unknown as typeof fetch).receipts(["a"])).rejects.toThrow(/500/);
    await expect(new LibraryExpoPushTransport(undefined, (() => reply({ errors: [] })) as unknown as typeof fetch).receipts(["a"])).rejects.toThrow(
      /unexpected/,
    );
  });
});
