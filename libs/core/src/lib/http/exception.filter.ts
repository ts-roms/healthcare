import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodValidationException } from "nestjs-zod";
import { ZodError } from "zod";
import { asPgError, PgErrorCode } from "../database/database";
import { patientMergedError } from "../database/patient-links";
import { DomainError } from "../errors";
import "./request-augmentation";

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Maps every error to the standard envelope. Unexpected errors are logged with
 * the request id and returned as a generic 500 so internals never leak.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    body.error.requestId = request.requestId;
    if (status >= 500) {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.route?.path ?? request.path} [${request.requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return envelope(exception.httpStatus, exception.code, exception.message, exception.details);
    }
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      return envelope(400, "validation_failed", "Request validation failed", zodError instanceof ZodError ? formatIssues(zodError) : undefined);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return envelope(status, httpCode(status), exception.message);
    }
    // New care addressed to a merged record, refused by the database (migration 0068).
    const merged = patientMergedError(exception);
    if (merged) return envelope(merged.httpStatus, merged.code, merged.message, merged.details);
    const pgError = asPgError(exception);
    if (pgError?.code === PgErrorCode.uniqueViolation || pgError?.code === PgErrorCode.exclusionViolation) {
      return envelope(409, "conflict", "The request conflicts with an existing record", { constraint: pgError.constraint });
    }
    if (pgError?.code === PgErrorCode.foreignKeyViolation || pgError?.code === PgErrorCode.checkViolation) {
      return envelope(422, "integrity_violation", "The request violates a data integrity rule", { constraint: pgError.constraint });
    }
    return envelope(500, "internal_error", "An unexpected error occurred");
  }
}

function envelope(status: number, code: string, message: string, details?: unknown): { status: number; body: ErrorBody } {
  return { status, body: { error: { code, message, ...(details === undefined ? {} : { details }) } } };
}

function formatIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function httpCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "bad_request";
    case HttpStatus.UNAUTHORIZED:
      return "unauthenticated";
    case HttpStatus.FORBIDDEN:
      return "forbidden";
    case HttpStatus.NOT_FOUND:
      return "not_found";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "rate_limited";
    default:
      return status >= 500 ? "internal_error" : "http_error";
  }
}
