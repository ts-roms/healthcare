import type { AddressInfo } from "node:net";
import { cachedHealthReport, type HealthCheck, healthDetailsVisible, healthReport, healthStatusCode, startHealthServer } from "./health-server";

const check = (name: string, required: boolean, state: "ok" | "unreachable" | "unconfigured" | Error): HealthCheck => ({
  name,
  required,
  probe: () => (state instanceof Error ? Promise.reject(state) : Promise.resolve(state)),
});

describe("healthReport", () => {
  it("is ok when every dependency answers", async () => {
    const report = await healthReport([check("database", true, "ok"), check("redis", false, "ok"), check("objectStorage", false, "unconfigured")]);
    expect(report).toEqual({ status: "ok", checks: { database: "ok", redis: "ok", objectStorage: "unconfigured" } });
    expect(healthStatusCode(report)).toBe(200);
  });

  it("is degraded, still 200, when an optional dependency is down — and unavailable, 503, when a required one is", async () => {
    const degraded = await healthReport([check("database", true, "ok"), check("redis", false, new Error("ECONNREFUSED"))]);
    expect(degraded).toEqual({ status: "degraded", checks: { database: "ok", redis: "unreachable" } });
    expect(healthStatusCode(degraded)).toBe(200);
    const down = await healthReport([check("database", true, new Error("down")), check("redis", false, "unreachable")]);
    expect(down.status).toBe("unavailable");
    expect(healthStatusCode(down)).toBe(503);
  });
});

describe("startHealthServer", () => {
  it("serves /live and /ready and nothing else", async () => {
    const server = startHealthServer(0, [check("database", true, "ok"), check("redis", false, "unreachable")], () => true);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const live = await fetch(`${base}/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ status: "ok" });
      const ready = await fetch(`${base}/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: "degraded", checks: { database: "ok", redis: "unreachable" } });
      expect((await fetch(`${base}/metrics`)).status).toBe(404);
      expect((await fetch(`${base}/ready`, { method: "POST" })).status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe("readiness details", () => {
  const token = "t".repeat(40);

  it("go only to a caller with the operators' token, else nobody in production and everyone elsewhere", () => {
    expect(healthDetailsVisible({ NODE_ENV: "production", HEALTH_DETAILS_TOKEN: token }, token)).toBe(true);
    expect(healthDetailsVisible({ NODE_ENV: "production", HEALTH_DETAILS_TOKEN: token }, "wrong")).toBe(false);
    expect(healthDetailsVisible({ NODE_ENV: "production", HEALTH_DETAILS_TOKEN: token }, undefined)).toBe(false);
    expect(healthDetailsVisible({ NODE_ENV: "production" }, token)).toBe(false);
    expect(healthDetailsVisible({ NODE_ENV: "development" }, undefined)).toBe(true);
  });

  it("are left out of a worker's answer by default: the status alone", async () => {
    const server = startHealthServer(0, [check("database", true, "ok"), check("redis", false, "unreachable")]);
    try {
      const ready = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: "degraded" });
    } finally {
      server.close();
    }
  });

  it("are checked at most once per window, however many probes arrive", async () => {
    let runs = 0;
    const report = cachedHealthReport([{ name: "database", required: true, probe: async () => (runs++, "ok") }], 60_000);
    await Promise.all([report(), report(), report()]);
    await report();
    expect(runs).toBe(1);
  });
});
