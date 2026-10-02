import type { Request, Response } from "express";
import { accessLogEntry } from "./access-log";

function request(over: Record<string, unknown> = {}): Request {
  return { method: "GET", path: "/api/v1/patients/0f3a", baseUrl: "", route: { path: "/api/v1/patients/:id" }, ...over } as unknown as Request;
}
const response = (statusCode: number) => ({ statusCode }) as Response;

describe("accessLogEntry", () => {
  it("logs the route template, status, duration, request id and the staff actor's id — nothing else", () => {
    const entry = accessLogEntry(
      request({
        requestId: "req-1234-abcd",
        actor: { kind: "user", userId: "u1", organizationId: "o1", permissions: new Set(), facilityId: "f1" },
        originalUrl: "/api/v1/patients/0f3a?name=Juan",
        body: { name: "Juan" },
        headers: { authorization: "Bearer secret" },
      }),
      response(200),
      12.6,
    );
    expect(entry).toEqual({
      event: "http.request",
      method: "GET",
      route: "/api/v1/patients/:id",
      status: 200,
      durationMs: 13,
      requestId: "req-1234-abcd",
      actor: { kind: "user", userId: "u1" },
    });
    expect(JSON.stringify(entry)).not.toMatch(/0f3a|Juan|secret/);
  });

  it("names a patient without an id, and an unauthenticated request without an actor", () => {
    expect(accessLogEntry(request({ patientPrincipal: { accountId: "a1", patientId: "p1" } }), response(200), 1)?.actor).toEqual({ kind: "patient" });
    expect(accessLogEntry(request(), response(401), 1)?.actor).toBeUndefined();
  });

  it("marks a request that matched no route and skips health probes", () => {
    expect(accessLogEntry(request({ route: undefined, path: "/api/v1/nothing" }), response(404), 1)?.route).toBe("(no route)");
    expect(accessLogEntry(request({ route: { path: "/api/v1/health/ready" } }), response(200), 1)).toBeUndefined();
    expect(accessLogEntry(request({ route: undefined, path: "/api/v1/health/live" }), response(200), 1)).toBeUndefined();
  });
});
