/**
 * Staff display names for the appointment list's "cancelled by" line. The clinic module provides it with the same
 * adapter as the immunization context (apps/api/src/app/adapters/immunization-adapters.ts), which answers this question
 * from the auth domain.
 */
export interface AppointmentStaffNames {
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
}

export const APPOINTMENT_STAFF_NAMES = Symbol("APPOINTMENT_STAFF_NAMES");
