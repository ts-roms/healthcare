import { metrics, type Attributes } from "@opentelemetry/api";

/**
 * The platform's own instruments (docs/architecture/observability.md, "Metrics"). They use the OpenTelemetry API
 * only: without an SDK started (no OTEL_EXPORTER_OTLP_ENDPOINT) every call is a no-op, so recording costs nothing.
 * Attribute values are names of queues and event types — never an id, a name or a value from a record.
 */
const meter = () => metrics.getMeter("healthcare-platform");

let outbox = { pending: 0, oldestAgeSeconds: 0 };
let outboxRegisteredOn: ReturnType<typeof meter> | undefined;

/** What the outbox relay found in its last batch: how many events still waited and how old the oldest was. */
export function recordOutboxBatch(pending: number, oldestOccurredAt: Date | null, now = new Date()): void {
  outbox = { pending, oldestAgeSeconds: oldestOccurredAt ? Math.max(0, (now.getTime() - oldestOccurredAt.getTime()) / 1000) : 0 };
  // Registered once per meter (again when a different meter provider is installed, as in tests).
  const current = meter();
  if (outboxRegisteredOn === current) return;
  outboxRegisteredOn = current;
  current
    .createObservableGauge("outbox.pending", { description: "Outbox events still to dispatch, as seen by the relay's last batch", unit: "{event}" })
    .addCallback((result) => result.observe(outbox.pending));
  current
    .createObservableGauge("outbox.oldest_age", { description: "Age of the oldest undispatched outbox event at the relay's last batch", unit: "s" })
    .addCallback((result) => result.observe(outbox.oldestAgeSeconds));
}

/** A handler failed for an event (retried with backoff, or parked after the last attempt). */
export function recordHandlerFailure(eventType: string, parked: boolean): void {
  meter()
    .createCounter("event.handler_failures", { description: "Domain event handler attempts that failed", unit: "{attempt}" })
    .add(1, { "event.type": eventType, "event.parked": parked } satisfies Attributes);
}

/** A BullMQ job attempt failed on a queue. */
export function recordJobFailure(queue: string): void {
  meter().createCounter("queue.job_failures", { description: "BullMQ job attempts that failed", unit: "{attempt}" }).add(1, { "queue.name": queue });
}

/** A queue reconciler could not re-enqueue stranded work. */
export function recordReconcileFailure(queue: string): void {
  meter().createCounter("queue.reconcile_failures", { description: "Queue reconciler runs that failed", unit: "{run}" }).add(1, { "queue.name": queue });
}

export type QueueDepth = Record<"waiting" | "delayed" | "failed", number>;

/**
 * Reports a queue's depth whenever metrics are collected. `read` is called at each collection (every export
 * interval); a failure to read (Redis down) reports nothing for that collection.
 */
export function observeQueueDepth(queue: string, read: () => Promise<QueueDepth>): void {
  const gauge = meter().createObservableGauge("queue.depth", { description: "Jobs waiting, delayed or failed on a BullMQ queue", unit: "{job}" });
  gauge.addCallback(async (result) => {
    let depth: QueueDepth;
    try {
      depth = await read();
    } catch {
      return;
    }
    for (const state of ["waiting", "delayed", "failed"] as const) result.observe(depth[state], { "queue.name": queue, "queue.state": state });
  });
}
