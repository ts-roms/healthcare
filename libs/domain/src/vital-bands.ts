/**
 * Adult reference bands for displaying vital signs, one source for every screen that marks a reading as high or low.
 * They are guidance for the person reading the value, never a diagnosis and never a rule the platform acts on; a deployment
 * that needs other bands (children, a protocol of its own) should source them from configuration. The API's own limits
 * (`libs/clinic` `domain/vital-signs.ts`) are different: data-entry guards against impossible values.
 */
export type VitalBandKey = "systolic" | "diastolic" | "heartRate" | "respiratoryRate" | "temperatureC" | "spo2" | "bmi";

export type VitalInterpretation = "normal" | "low" | "high";

export const ADULT_VITAL_BANDS: Record<VitalBandKey, { low: number; high: number }> = {
  systolic: { low: 90, high: 139 },
  diastolic: { low: 60, high: 89 },
  heartRate: { low: 60, high: 100 },
  respiratoryRate: { low: 12, high: 20 },
  temperatureC: { low: 36, high: 37.5 },
  spo2: { low: 95, high: 100 },
  bmi: { low: 18.5, high: 24.9 },
};

/** Where a reading sits against the band; a missing reading is "normal" (nothing to flag). */
export function interpretVital(key: VitalBandKey, value: number | undefined): VitalInterpretation {
  if (value === undefined) return "normal";
  const band = ADULT_VITAL_BANDS[key];
  return value < band.low ? "low" : value > band.high ? "high" : "normal";
}
