import { trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { isDroppedAttribute, ScrubbingSpanProcessor, scrubSpanAttributes } from "./scrub";

describe("span scrubbing", () => {
  it("drops URLs, query strings, headers, client addresses and Redis arguments, and keeps route, method and status", () => {
    const span = {
      attributes: {
        "http.method": "GET",
        "http.route": "/api/v1/patients/:id",
        "http.status_code": 200,
        "http.url": "http://api/api/v1/patients/9b5f?search=Dela+Cruz",
        "http.target": "/api/v1/patients/9b5f?search=Dela+Cruz",
        "url.full": "http://api/api/v1/patients/9b5f",
        "url.path": "/api/v1/patients/9b5f",
        "url.query": "search=Dela+Cruz",
        "http.request.header.authorization": ["Bearer x"],
        "http.response.header.set-cookie": ["a=b"],
        "client.address": "203.0.113.5",
        "net.peer.ip": "203.0.113.5",
        "network.peer.address": "203.0.113.5",
        "network.peer.port": 51234,
        "user_agent.original": "Mozilla/5.0",
        "db.query.parameter.0": "9b5f",
        "db.statement": "select * from patient where id = $1",
        "db.system": "postgresql",
        "server.address": "api",
      },
    };
    const removed = scrubSpanAttributes(span);
    expect(Object.keys(span.attributes).sort()).toEqual(["db.statement", "db.system", "http.method", "http.route", "http.status_code", "server.address"]);
    expect(removed).toHaveLength(13);
    expect(isDroppedAttribute("http.request.header.x-request-id")).toBe(true);
    expect(isDroppedAttribute("http.route")).toBe(false);
  });

  it("scrubs every span before the exporter sees it", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new ScrubbingSpanProcessor(), new SimpleSpanProcessor(exporter)] });
    const span = provider.getTracer("test").startSpan("GET /api/v1/patients/:id", {
      attributes: { "http.url": "http://api/api/v1/patients/9b5f", "http.route": "/api/v1/patients/:id", "net.peer.ip": "203.0.113.5" },
    });
    span.setAttribute("url.query", "q=Reyes");
    span.end();
    await provider.forceFlush();
    const [exported] = exporter.getFinishedSpans();
    expect(exported?.attributes).toEqual({ "http.route": "/api/v1/patients/:id" });
    expect(JSON.stringify({ name: exported?.name, attributes: exported?.attributes, events: exported?.events })).not.toContain("9b5f");
    await provider.shutdown();
    expect(trace.getActiveSpan()).toBeUndefined();
  });
});
