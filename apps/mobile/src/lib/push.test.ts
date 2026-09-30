import { describe, expect, it } from "vitest";
import { ApiError, type ApiClient } from "./api";
import { enableMessage, enablePush, pushState, type PushPlatform, unregisterThisPhone } from "./push";
import type { PushStatus } from "./types";

const TOKEN = "ExponentPushToken[abcdefghijkl]";

function platform(over: Partial<PushPlatform> & { permissionNow?: "granted" | "denied" | "undetermined" } = {}): PushPlatform & { requested: number } {
  let permission = over.permissionNow ?? "undetermined";
  const p = {
    isPhysicalDevice: true,
    os: "ios" as const,
    deviceName: "Juan's phone",
    permission: async () => permission,
    requestPermission: async () => {
      p.requested += 1;
      permission = over.permissionNow === "denied" ? "denied" : "granted";
      return permission as "granted" | "denied";
    },
    token: async () => TOKEN,
    requested: 0,
    ...over,
  };
  return p;
}

function fakeApi(status: Partial<PushStatus> = {}, post?: (path: string, body: unknown) => unknown) {
  const posts: Array<{ path: string; body: unknown }> = [];
  const gets: string[] = [];
  const api = {
    get: async (path: string) => {
      gets.push(path);
      return { configured: false, mobileConfigured: true, devices: [], thisDeviceId: null, ...status };
    },
    post: async (path: string, body?: unknown) => {
      posts.push({ path, body });
      return post ? post(path, body) : { id: "device-1" };
    },
  } as unknown as ApiClient;
  return { api, posts, gets };
}

describe("push state", () => {
  it("is unavailable in a simulator and when the clinic has not turned it on", async () => {
    expect((await pushState(fakeApi().api, platform({ isPhysicalDevice: false }))).state).toEqual({ kind: "unavailable", reason: "simulator" });
    expect((await pushState(fakeApi({ mobileConfigured: false }).api, platform())).state).toEqual({ kind: "unavailable", reason: "not_offered" });
  });

  it("is on when this phone's token is registered, asking the API about that token", async () => {
    const { api, gets } = fakeApi({ thisDeviceId: "d1" });
    expect((await pushState(api, platform({ permissionNow: "granted" }))).state).toEqual({ kind: "on", deviceId: "d1" });
    expect(gets[0]).toBe(`/portal/push?token=${encodeURIComponent(TOKEN)}`);
  });

  it("is off, and can be asked for unless the phone blocked it", async () => {
    expect((await pushState(fakeApi().api, platform())).state).toEqual({ kind: "off", canAsk: true });
    expect((await pushState(fakeApi().api, platform({ permissionNow: "denied" }))).state).toEqual({ kind: "off", canAsk: false });
  });
});

describe("turning notifications on", () => {
  it("asks the phone, then registers the token with the platform and a device name", async () => {
    const p = platform();
    const { api, posts } = fakeApi();
    await expect(enablePush(api, p)).resolves.toEqual({ ok: true, deviceId: "device-1" });
    expect(p.requested).toBe(1);
    expect(posts).toEqual([{ path: "/portal/push/mobile-devices", body: { token: TOKEN, platform: "ios", deviceName: "Juan's phone" } }]);
  });

  it("does not ask again when already allowed, and registers without a name when there is none", async () => {
    const p = platform({ permissionNow: "granted", deviceName: null });
    const { api, posts } = fakeApi();
    await enablePush(api, p);
    expect(p.requested).toBe(0);
    expect(posts[0]!.body).toEqual({ token: TOKEN, platform: "ios" });
  });

  it("stops when the phone says no, and registers nothing", async () => {
    const { api, posts } = fakeApi();
    expect(await enablePush(api, platform({ permissionNow: "denied" }))).toEqual({ ok: false, reason: "denied" });
    expect(posts).toEqual([]);
  });

  it("explains the platform's refusals", async () => {
    const refuse = (code: string) =>
      fakeApi({}, () => {
        throw new ApiError(422, code, "message from the API");
      }).api;
    const tooMany = await enablePush(refuse("too_many_push_devices"), platform());
    expect(tooMany).toMatchObject({ ok: false, reason: "too_many_devices" });
    expect(await enablePush(refuse("push_not_available"), platform())).toEqual({ ok: false, reason: "not_offered" });
    expect(await enablePush(refuse("other"), platform())).toMatchObject({ ok: false, reason: "failed", message: "message from the API" });
    expect(enableMessage({ ok: false, reason: "denied" })).toMatch(/settings/);
    expect(enableMessage({ ok: false, reason: "too_many_devices" })).toMatch(/5 devices/);
  });
});

describe("signing out", () => {
  it("removes this phone's registration first", async () => {
    const { api, posts } = fakeApi({ thisDeviceId: "d1" });
    await unregisterThisPhone(api, platform({ permissionNow: "granted" }));
    expect(posts.map((p) => p.path)).toEqual(["/portal/push/subscriptions/d1/remove"]);
  });

  it("does nothing when this phone is not registered, and never blocks sign-out when the API fails", async () => {
    const { api, posts } = fakeApi();
    await unregisterThisPhone(api, platform({ permissionNow: "granted" }));
    expect(posts).toEqual([]);
    const broken = { get: async () => Promise.reject(new Error("offline")), post: async () => undefined } as unknown as ApiClient;
    await expect(unregisterThisPhone(broken, platform({ permissionNow: "granted" }))).resolves.toBeUndefined();
  });
});
