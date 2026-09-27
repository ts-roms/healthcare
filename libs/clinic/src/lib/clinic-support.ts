import { NotFoundError, VersionConflictError } from '@healthcare/core';

/** Drops internal columns before returning a record to API callers. */
export function publicView<T extends { organizationId: string }>(record: T): Omit<T, 'organizationId'> {
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
