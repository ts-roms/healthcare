import type { LoggerService } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import "./request-augmentation";

/** One line per finished request: ids and shapes only — never the URL's ids or query string, a name, an address or a body. */
export interface AccessLogEntry {
  event: "http.request";
  method: string;
  /** The registered route template (`/api/v1/patients/:id`), or the path with no template when no route matched. */
  route: string;
  status: number;
  durationMs: number;
  requestId?: string;
  /** The staff user behind the request, when authenticated. Patients are logged as `patient` without an id. */
  actor?: { kind: "user" | "system"; userId: string } | { kind: "patient" };
}

const HEALTH_PREFIX = /^\/api\/v\d+\/health\//;

export function accessLogEntry(req: Request, res: Response, durationMs: number): AccessLogEntry | undefined {
  const path = req.route?.path ?? (req.baseUrl ? `${req.baseUrl}${req.path}` : req.path);
  if (HEALTH_PREFIX.test(path)) return undefined;
  const entry: AccessLogEntry = {
    event: "http.request",
    method: req.method,
    route: req.route?.path ?? "(no route)",
    status: res.statusCode,
    durationMs: Math.round(durationMs),
  };
  if (req.requestId) entry.requestId = req.requestId;
  if (req.actor) entry.actor = { kind: req.actor.kind, userId: req.actor.userId };
  else if ("patientPrincipal" in req && req.patientPrincipal) entry.actor = { kind: "patient" };
  return entry;
}

/** Logs every finished request through the application logger (JSON in production). Health probes are not logged. */
export function accessLogMiddleware(logger: LoggerService): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const entry = accessLogEntry(req, res, Number(process.hrtime.bigint() - started) / 1_000_000);
      if (entry) logger.log(entry, "Http");
    });
    next();
  };
}
