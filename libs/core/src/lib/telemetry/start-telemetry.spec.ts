import { isHealthProbePath, redisStatement, startTelemetry, telemetryStartupEvent } from "./start-telemetry";

describe("telemetry bootstrap", () => {
  it("is off without an endpoint, and says so without an endpoint or headers in the log line", () => {
    expect(startTelemetry("healthcare-api", {})).toBeNull();
    expect(startTelemetry("healthcare-api", { OTEL_EXPORTER_OTLP_ENDPOINT: "  " })).toBeNull();
    expect(telemetryStartupEvent(null)).toMatchObject({ event: "telemetry.off" });
    const line = telemetryStartupEvent({
      endpoint: "https://otlp.example.net:4318/v1",
      instrumentations: ["@opentelemetry/instrumentation-http"],
      shutdown: async () => undefined,
    });
    expect(line).toEqual({ event: "telemetry.started", endpointHost: "otlp.example.net:4318", instrumentations: ["@opentelemetry/instrumentation-http"] });
    expect(JSON.stringify(line)).not.toContain("/v1");
  });

  it("starts with an endpoint, registers the five instrumentations and shuts down cleanly", async () => {
    const handle = startTelemetry("healthcare-test", { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1" });
    expect(handle?.instrumentations).toEqual([
      "@opentelemetry/instrumentation-http",
      "@opentelemetry/instrumentation-express",
      "@opentelemetry/instrumentation-nestjs-core",
      "@opentelemetry/instrumentation-pg",
      "@opentelemetry/instrumentation-ioredis",
    ]);
    await handle?.shutdown();
  });

  it("leaves health probes untraced and reports Redis commands by name only", () => {
    expect(isHealthProbePath("/api/v1/health/ready")).toBe(true);
    expect(isHealthProbePath("/live")).toBe(true);
    expect(isHealthProbePath("/ready")).toBe(true);
    expect(isHealthProbePath("/api/v1/patients/9b5f")).toBe(false);
    expect(redisStatement("evalsha", ["throttle:203.0.113.5", "1"])).toBe("evalsha");
  });
});
