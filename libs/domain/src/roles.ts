/** Staff roles drive which modules appear in navigation and which dashboard is shown. */
export type StaffRole = "doctor" | "nurse" | "reception" | "lab-tech" | "dentist" | "billing" | "admin";

export const STAFF_ROLES: { value: StaffRole; label: string }[] = [
  { value: "doctor", label: "Doctor" },
  { value: "nurse", label: "Nurse" },
  { value: "reception", label: "Reception" },
  { value: "lab-tech", label: "Lab Technician" },
  { value: "dentist", label: "Dentist" },
  { value: "billing", label: "Billing" },
  { value: "admin", label: "Administrator" },
];

export function isStaffRole(value: unknown): value is StaffRole {
  return STAFF_ROLES.some((r) => r.value === value);
}
