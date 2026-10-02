import { metrics } from "@opentelemetry/api";
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { observeQueueDepth, recordHandlerFailure, recordJobFailure, recordOutboxBatch, recordReconcileFailure } from "./metrics";

describe("platform metrics", () => {
  it("record nothing without an SDK", () => {
    expect(() => {
      recordOutboxBatch(3, new Date());
      recordHandlerFailure("PatientRegistered", false);
      recordJobFailure("notifications");
      recordReconcileFailure("notifications");
      observeQueueDepth("notifications", async () => ({ waiting: 1, delayed: 0, failed: 0 }));
    }).not.toThrow();
  });

  it("report queue depth, outbox state and failure counts with queue and event names only", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    try {
      observeQueueDepth("integrations", async () => ({ waiting: 4, delayed: 1, failed: 2 }));
      observeQueueDepth("broken", async () => {
        throw new Error("Redis down");
      });
      recordOutboxBatch(7, new Date(Date.now() - 90_000));
      recordHandlerFailure("LaboratoryResultReleased", true);
      recordJobFailure("integrations");
      await reader.forceFlush();
      const byName = new Map(
        exporter
          .getMetrics()
          .flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics))
          .map((m) => [m.descriptor.name, m]),
      );
      const depth = byName.get("queue.depth")!.dataPoints.map((p) => [p.attributes["queue.name"], p.attributes["queue.state"], p.value]);
      expect(depth).toEqual([
        ["integrations", "waiting", 4],
        ["integrations", "delayed", 1],
        ["integrations", "failed", 2],
      ]);
      expect(byName.get("outbox.pending")!.dataPoints[0]!.value).toBe(7);
      expect(byName.get("outbox.oldest_age")!.dataPoints[0]!.value).toBeGreaterThanOrEqual(89);
      expect(byName.get("event.handler_failures")!.dataPoints[0]!.attributes).toEqual({ "event.type": "LaboratoryResultReleased", "event.parked": true });
      expect(byName.get("queue.job_failures")!.dataPoints[0]!.attributes).toEqual({ "queue.name": "integrations" });
    } finally {
      await provider.shutdown();
      metrics.disable();
    }
  });
});
