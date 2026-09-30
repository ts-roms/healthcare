/**
 * Staff display names for the patient history's "recorded by" lines. The clinic module provides it with the same
 * adapter as the immunization context (apps/api/src/app/adapters/immunization-adapters.ts), which already answers
 * this question from the auth domain.
 */
export interface HistoryStaffNames {
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
}

export const HISTORY_STAFF_NAMES = Symbol("HISTORY_STAFF_NAMES");
