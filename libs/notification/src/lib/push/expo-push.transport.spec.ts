import { expoTokenIsGone, LibraryExpoPushTransport, type ExpoPushMessage } from "./expo-push.transport";

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
});
