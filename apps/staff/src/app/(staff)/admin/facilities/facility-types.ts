/** Mirrors FACILITY_TYPES in libs/organization (organization.schema.ts). */
export const FACILITY_TYPES = [
  { value: "clinic", label: "Clinic" },
  { value: "laboratory", label: "Laboratory" },
  { value: "dental_clinic", label: "Dental clinic" },
  { value: "hospital", label: "Hospital" },
  { value: "diagnostic_center", label: "Diagnostic center" },
  { value: "telemedicine_hub", label: "Telemedicine hub" },
  { value: "other", label: "Other" },
] as const;

export const facilityTypeLabel = (value: string) => FACILITY_TYPES.find((t) => t.value === value)?.label ?? value;
