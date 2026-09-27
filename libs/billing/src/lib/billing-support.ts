import { type DbExecutor, NotFoundError, VersionConflictError } from "@healthcare/core";
import { sql } from "drizzle-orm";

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

/** The calendar day before a YYYY-MM-DD date. */
export function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** "•••• 1234": enough to recognise an ID number on screen without exposing it. */
export function maskIdNumber(value: string | null): string | null {
  if (!value) return null;
  const tail = value.replace(/\s/g, "").slice(-4);
  return `•••• ${tail}`;
}

/**
 * Serializes changes to one patient's account at one facility (deposits, applications, credit, refunds) for the
 * rest of the transaction. Taken after any invoice lock, never before, so the lock order is always the same.
 */
export async function lockPatientAccount(tx: DbExecutor, organizationId: string, facilityId: string, patientId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-account:${organizationId}:${facilityId}:${patientId}`}, 0))`);
}
