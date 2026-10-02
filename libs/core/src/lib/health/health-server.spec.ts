import type { AddressInfo } from "node:net";
import { type HealthCheck, healthReport, healthStatusCode, startHealthServer } from "./health-server";

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
    const server = startHealthServer(0, [check("database", true, "ok"), check("redis", false, "unreachable")]);
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
