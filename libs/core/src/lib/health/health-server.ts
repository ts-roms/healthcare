import { createServer, type Server } from "node:http";

/** The outcome of one dependency check: reachable, unreachable (with a reason), or not configured. */
export type DependencyState = "ok" | "unreachable" | "unconfigured";

export interface HealthReport {
  status: "ok" | "degraded" | "unavailable";
  checks: Record<string, DependencyState>;
}

export interface HealthCheck {
  name: string;
  /** Whether the process cannot serve without it (database) or only serves degraded without it (Redis, storage). */
  required: boolean;
  probe: () => Promise<DependencyState>;
}

/**
 * Runs the checks in parallel and combines them (docs/architecture/observability.md): a required dependency down →
 * `unavailable`; an optional one down → `degraded`; otherwise `ok`. A probe that throws counts as unreachable.
 */
export async function healthReport(checks: HealthCheck[]): Promise<HealthReport> {
  const states = await Promise.all(checks.map(async (check) => [check, await check.probe().catch((): DependencyState => "unreachable")] as const));
  const report: HealthReport = { status: "ok", checks: {} };
  for (const [check, state] of states) {
    report.checks[check.name] = state;
    if (state !== "unreachable") continue;
    if (check.required) report.status = "unavailable";
    else if (report.status === "ok") report.status = "degraded";
  }
  return report;
}

/** `503` only when the process cannot serve; degraded still answers `200` so a Redis outage does not take it off routing. */
export function healthStatusCode(report: HealthReport): number {
  return report.status === "unavailable" ? 503 : 200;
}

/**
 * A minimal HTTP server for processes without one (the workers): `GET /live` (the process is up) and `GET /ready` (its
 * dependencies). Started only when `HEALTH_PORT` is set. No other route; nothing about the data.
 */
export function startHealthServer(port: number, checks: HealthCheck[]): Server {
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0];
    if (req.method !== "GET" || (path !== "/live" && path !== "/ready")) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ status: "not_found" }));
      return;
    }
    if (path === "/live") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }));
      return;
    }
    void healthReport(checks).then((report) => {
      res.writeHead(healthStatusCode(report), { "content-type": "application/json" }).end(JSON.stringify(report));
    });
  });
  server.listen(port);
  return server;
}
