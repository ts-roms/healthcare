import type { Request } from "express";
import type { RequestMetadata } from "../actor";
import "./request-augmentation";

export function requestMetadataFrom(request: Request): RequestMetadata {
  return {
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.header("user-agent"),
  };
}
