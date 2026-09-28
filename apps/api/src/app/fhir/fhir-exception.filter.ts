import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { DomainError } from "@healthcare/core";
import { FhirImportError, FhirSearchError, operationOutcome } from "@healthcare/interoperability";
import type { Request, Response } from "express";
import { ZodValidationException } from "nestjs-zod";

type IssueCode = Parameters<typeof operationOutcome>[0];

function issueCode(status: number): IssueCode {
  if (status === 400 || status === 422) return "invalid";
  if (status === 401) return "login";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 413) return "too-costly";
  if (status === 429) return "throttled";
  return "exception";
}

/** Errors on the FHIR interface are OperationOutcome resources (FHIR R4 §3.1.0.4), not the platform's error envelope. */
@Catch()
export class FhirExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(FhirExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof FhirImportError) {
      // Every problem found in received content, each with its location.
      const suffix = request.requestId ? ` (request ${request.requestId})` : "";
      response
        .status(exception.status)
        .type("application/fhir+json")
        .json({
          resourceType: "OperationOutcome",
          issue: exception.issues.map((issue) => ({
            severity: "error",
            code: issue.code,
            diagnostics: `${issue.diagnostics}${suffix}`,
            ...(issue.expression ? { expression: [issue.expression] } : {}),
          })),
        });
      return;
    }
    let status = 500;
    let message = "An unexpected error occurred";
    let code: IssueCode | undefined;
    if (exception instanceof FhirSearchError) {
      status = 400;
      message = exception.message;
      code = exception.code;
    } else if (exception instanceof DomainError) {
      status = exception.httpStatus;
      message = exception.message;
    } else if (exception instanceof ZodValidationException) {
      status = 400;
      message = "Request validation failed";
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    } else {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.path} [${request.requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response
      .status(status)
      .type("application/fhir+json")
      .json(operationOutcome(code ?? issueCode(status), request.requestId ? `${message} (request ${request.requestId})` : message));
  }
}
