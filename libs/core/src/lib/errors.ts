/**
 * Application errors are transport-agnostic; the HTTP exception filter maps
 * them to status codes and the standard error envelope.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = "not_found";
  readonly httpStatus = 404;
  constructor(resource: string) {
    super(`${resource} not found`);
  }
}

/** Well-formed request that is missing required context (e.g. a header). */
export class BadRequestError extends DomainError {
  readonly code: string;
  readonly httpStatus = 400;
  constructor(message: string, code = "bad_request", details?: unknown) {
    super(message, details);
    this.code = code;
  }
}

export class ConflictError extends DomainError {
  readonly code: string;
  readonly httpStatus = 409;
  constructor(message: string, details?: unknown, code = "conflict") {
    super(message, details);
    this.code = code;
  }
}

/** Optimistic-locking failure: the caller edited a stale version. */
export class VersionConflictError extends DomainError {
  readonly code = "version_conflict";
  readonly httpStatus = 409;
  constructor(resource: string, expected: number) {
    super(`${resource} was modified by someone else (expected version ${expected}). Reload and try again.`);
  }
}

export class BusinessRuleError extends DomainError {
  readonly code: string;
  readonly httpStatus = 422;
  constructor(message: string, code = "business_rule_violation", details?: unknown) {
    super(message, details);
    this.code = code;
  }
}

export class ForbiddenError extends DomainError {
  readonly code: string;
  readonly httpStatus = 403;
  constructor(message = "You do not have permission to perform this action", code = "forbidden") {
    super(message);
    this.code = code;
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code: string;
  readonly httpStatus = 401;
  constructor(message = "Authentication required", code = "unauthenticated") {
    super(message);
    this.code = code;
  }
}
