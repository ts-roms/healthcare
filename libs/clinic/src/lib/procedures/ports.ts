/**
 * Staff display names for "recorded by" lines. The clinic module provides it with the same adapter as the
 * immunization context (apps/api/src/app/adapters/immunization-adapters.ts).
 */
export interface ProcedureStaffNames {
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
}

export const PROCEDURE_STAFF_NAMES = Symbol("PROCEDURE_STAFF_NAMES");
