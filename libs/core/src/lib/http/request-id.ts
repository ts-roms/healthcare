import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import './request-augmentation';

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Accepts a well-formed upstream request id or generates one, and echoes it back. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
