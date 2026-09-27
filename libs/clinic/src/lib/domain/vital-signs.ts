/**
 * Server-side plausibility limits for vital signs (CLAUDE.md clinic rules:
 * reject physiologically impossible values, never auto-correct).
 * These are data-entry guards, deliberately wide, not clinical reference
 * ranges: the platform does not classify values as normal/abnormal.
 */
export const VITAL_LIMITS = {
  systolicMmhg: { min: 40, max: 300, unit: 'mmHg' },
  diastolicMmhg: { min: 20, max: 200, unit: 'mmHg' },
  heartRateBpm: { min: 20, max: 300, unit: '/min' },
  respiratoryRateBpm: { min: 4, max: 80, unit: '/min' },
  temperatureC: { min: 30, max: 45, unit: '°C' },
  spo2Percent: { min: 50, max: 100, unit: '%' },
  weightKg: { min: 0.3, max: 400, unit: 'kg' },
  heightCm: { min: 20, max: 260, unit: 'cm' },
  bloodGlucoseMgDl: { min: 10, max: 1500, unit: 'mg/dL' },
} as const;

export type VitalKey = keyof typeof VITAL_LIMITS;
export type VitalValues = Partial<Record<VitalKey, number>>;

export interface VitalProblem {
  field: VitalKey;
  message: string;
}

export function implausibleVitals(values: VitalValues): VitalProblem[] {
  const problems: VitalProblem[] = [];
  for (const [field, limit] of Object.entries(VITAL_LIMITS) as Array<[VitalKey, (typeof VITAL_LIMITS)[VitalKey]]>) {
    const value = values[field];
    if (value === undefined) continue;
    if (value < limit.min || value > limit.max) {
      problems.push({ field, message: `${value} ${limit.unit} is outside the accepted range ${limit.min}–${limit.max} ${limit.unit}; check the entry` });
    }
  }
  if ((values.systolicMmhg === undefined) !== (values.diastolicMmhg === undefined)) {
    problems.push({ field: 'systolicMmhg', message: 'Record both systolic and diastolic pressure' });
  } else if (values.systolicMmhg !== undefined && values.diastolicMmhg !== undefined && values.systolicMmhg <= values.diastolicMmhg) {
    problems.push({ field: 'diastolicMmhg', message: 'Diastolic pressure must be lower than systolic pressure' });
  }
  return problems;
}

/** Body-mass index (kg/m²), rounded to one decimal, computed for display only. */
export function bodyMassIndex(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!weightKg || !heightCm) return null;
  const meters = heightCm / 100;
  return Math.round((weightKg / (meters * meters)) * 10) / 10;
}
