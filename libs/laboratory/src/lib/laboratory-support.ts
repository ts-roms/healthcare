import { asPgError, ConflictError, NotFoundError, PgErrorCode, VersionConflictError } from "@healthcare/core";

/** Drops internal columns before returning a record to API callers. */
export function publicView<T extends { organizationId: string }>(record: T): Omit<T, "organizationId"> {
  const { organizationId: _organizationId, ...rest } = record;
  return rest;
}

export function found<T>(row: T | undefined, resource: string): T {
  if (!row) throw new NotFoundError(resource);
  return row;
}

export function assertVersion(current: number, expected: number, resource: string): void {
  if (current !== expected) throw new VersionConflictError(resource, expected);
}

/** Turns a unique violation (e.g. a duplicate code) into a 409 with a readable message. */
export async function uniquely<T>(work: () => Promise<T>, message: string, code: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new ConflictError(message, undefined, code);
    throw error;
  }
}
