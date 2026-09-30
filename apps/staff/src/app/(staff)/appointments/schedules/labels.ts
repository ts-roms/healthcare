/** Mirror the clinic library's PROFESSIONS and ROOM_TYPES (libs/clinic/src/lib/clinic.schema.ts). */
export const PROFESSIONS = [
  { value: "physician", label: "Physician" },
  { value: "dentist", label: "Dentist" },
  { value: "nurse", label: "Nurse" },
  { value: "midwife", label: "Midwife" },
  { value: "medical_technologist", label: "Medical technologist" },
  { value: "pharmacist", label: "Pharmacist" },
  { value: "other", label: "Other" },
] as const;

export const ROOM_TYPES = [
  { value: "consultation", label: "Consultation" },
  { value: "triage", label: "Triage" },
  { value: "procedure", label: "Procedure" },
  { value: "dental", label: "Dental" },
  { value: "other", label: "Other" },
] as const;

/** 0 = Sunday, as stored (database/migrations/0009_clinic.sql). */
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const labelOf = (list: ReadonlyArray<{ value: string; label: string }>, value: string) => list.find((i) => i.value === value)?.label ?? value;
