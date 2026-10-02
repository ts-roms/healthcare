import { startTelemetry } from "@healthcare/core/telemetry";

/**
 * OpenTelemetry for this process, started while this module is evaluated — before `main.ts` loads anything
 * instrumented (docs/architecture/observability.md). Null unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
export const telemetry = startTelemetry("healthcare-integration-worker");
