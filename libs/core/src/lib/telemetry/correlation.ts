import { trace } from "@opentelemetry/api";

/** The active trace and span ids, for log lines that should meet their trace; nothing without telemetry. */
export function traceContext(): { traceId: string; spanId: string } | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  return context ? { traceId: context.traceId, spanId: context.spanId } : undefined;
}
