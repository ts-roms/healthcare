import { timingSafeEqual } from "node:crypto";
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

/** How long a readiness answer is reused: a flood of probes costs one round of checks per window, not one per request. */
export const HEALTH_REPORT_CACHE_MS = 5_000;

/** A readiness function that runs the checks at most once per `HEALTH_REPORT_CACHE_MS` (concurrent callers share it). */
export function cachedHealthReport(checks: HealthCheck[], cacheMs = HEALTH_REPORT_CACHE_MS): () => Promise<HealthReport> {
  let last: { at: number; report: Promise<HealthReport> } | undefined;
  return () => {
    const now = Date.now();
    if (!last || now - last.at >= cacheMs) last = { at: now, report: healthReport(checks) };
    return last.report;
  };
}

/**
 * Whether a readiness caller sees each dependency's state (zero trust: the public answer is the status alone, so
 * nobody learns that, say, malware scanning is down). With HEALTH_DETAILS_TOKEN set, only a caller sending it; without
 * it, everyone outside production and nobody in production.
 */
export function healthDetailsVisible(config: { NODE_ENV: string; HEALTH_DETAILS_TOKEN?: string }, presented: string | string[] | undefined): boolean {
  const token = config.HEALTH_DETAILS_TOKEN;
  if (!token) return config.NODE_ENV !== "production";
  const value = Array.isArray(presented) ? presented[0] : presented;
  if (typeof value !== "string") return false;
  const a = Buffer.from(value);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What a caller is shown: the whole report, or the status alone. */
export function healthAnswer(report: HealthReport, detailed: boolean): HealthReport | { status: HealthReport["status"] } {
  return detailed ? report : { status: report.status };
}

/** `503` only when the process cannot serve; degraded still answers `200` so a Redis outage does not take it off routing. */
export function healthStatusCode(report: HealthReport): number {
  return report.status === "unavailable" ? 503 : 200;
}

/**
 * A minimal HTTP server for processes without one (the workers): `GET /live` (the process is up) and `GET /ready` (its
 * dependencies). Started only when `HEALTH_PORT` is set. No other route; nothing about the data.
 */
export function startHealthServer(
  port: number,
  checks: HealthCheck[],
  detailsVisible: (presented: string | string[] | undefined) => boolean = () => false,
): Server {
  const report = cachedHealthReport(checks);
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
    void report().then((current) => {
      const body = healthAnswer(current, detailsVisible(req.headers["x-health-token"]));
      res.writeHead(healthStatusCode(current), { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  server.listen(port);
  return server;
}
