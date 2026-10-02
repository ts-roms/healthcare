import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation, ExpressLayerType } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { NestInstrumentation } from "@opentelemetry/instrumentation-nestjs-core";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ScrubbingSpanProcessor } from "./scrub";

export interface TelemetryHandle {
  /** The OTLP endpoint traces and metrics go to (host only in logs; headers are never logged). */
  endpoint: string;
  /** The instrumentations registered, for the start-up log line. */
  instrumentations: string[];
  shutdown(): Promise<void>;
}

/** Health probes make no traces (they are not in the access log either). */
const HEALTH_PATH = /^\/(api\/v\d+\/health\/|live$|ready$)/;

export function isHealthProbePath(url: string | undefined): boolean {
  return HEALTH_PATH.test(url ?? "");
}

/** The ioredis span statement: the command name only, never its arguments (keys can carry an address or a session id). */
export function redisStatement(commandName: string, _args?: unknown): string {
  return commandName;
}

/**
 * Starts OpenTelemetry for a process when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and returns null otherwise
 * (docs/architecture/observability.md, "Traces and metrics"). Must run before any instrumented module (`http`,
 * `express`, `@nestjs/core`, `pg`, `ioredis`) is loaded: import `@healthcare/core/telemetry` first in `main.ts`.
 * No backend is chosen here: traces and metrics go to whatever receives OTLP over HTTP at the endpoint, with the
 * headers in `OTEL_EXPORTER_OTLP_HEADERS` (the exporters read both). Every span is scrubbed of URLs, query strings,
 * headers, client addresses and Redis arguments before export.
 */
export function startTelemetry(serviceName: string, env: NodeJS.ProcessEnv = process.env): TelemetryHandle | null {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return null;
  if (env.OTEL_LOG_LEVEL)
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel[env.OTEL_LOG_LEVEL.toUpperCase() as keyof typeof DiagLogLevel] ?? DiagLogLevel.WARN);
  const instrumentations = [
    new HttpInstrumentation({ ignoreIncomingRequestHook: (request) => isHealthProbePath(request.url) }),
    // One span per route handler; the middleware chain (body parsing, access log) is not worth a span each.
    new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
    new NestInstrumentation(),
    // Statements are parametrized by Drizzle, so the SQL text carries no values; parameter values are never reported.
    new PgInstrumentation({ enhancedDatabaseReporting: false }),
    new IORedisInstrumentation({ dbStatementSerializer: redisStatement }),
  ];
  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME?.trim() || serviceName,
    spanProcessors: [new ScrubbingSpanProcessor(), new BatchSpanProcessor(new OTLPTraceExporter())],
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
    instrumentations,
  });
  sdk.start();
  const shutdown = () => sdk.shutdown().catch(() => undefined);
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  return { endpoint, instrumentations: instrumentations.map((i) => i.instrumentationName), shutdown };
}

/** The `telemetry.started` / `telemetry.off` log line for a process, without the endpoint's headers. */
export function telemetryStartupEvent(handle: TelemetryHandle | null): Record<string, unknown> {
  if (!handle) return { event: "telemetry.off", message: "OTEL_EXPORTER_OTLP_ENDPOINT is not set; no traces or metrics are exported" };
  let host = handle.endpoint;
  try {
    host = new URL(handle.endpoint).host;
  } catch {
    // Not a URL: logged as given.
  }
  return { event: "telemetry.started", endpointHost: host, instrumentations: handle.instrumentations };
}
