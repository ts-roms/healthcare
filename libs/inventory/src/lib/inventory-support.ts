import { NotFoundError, VersionConflictError } from "@healthcare/core";

export function strip<T extends { organizationId: string }>(row: T): Omit<T, "organizationId"> {
  const { organizationId: _o, ...rest } = row;
  return rest;
}

export function found<T>(row: T | undefined, resource: string): T {
  if (!row) throw new NotFoundError(resource);
  return row;
}

export function assertVersion(current: number, expected: number, resource: string): void {
  if (current !== expected) throw new VersionConflictError(resource, expected);
}
