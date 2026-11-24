import type { OutreachSegmentCriteria } from "./api/types";

/**
 * A new segment the outreach screen opens filled in, from a link such as an assistant audience idea's
 * (`/outreach?segment=new&name=Not+seen+in+5+months&noVisitForMonths=5`). Only the known criteria are read, each within
 * the ranges the API accepts; anything else is ignored. The form still shows every value before anything is saved, and
 * the API validates the segment again.
 */
export interface SegmentDraft {
  name: string;
  criteria: OutreachSegmentCriteria;
}

type Params = Record<string, string | string[] | undefined>;

const INTEGERS = {
  ageMin: [0, 120],
  ageMax: [0, 120],
  noVisitForMonths: [1, 120],
  carePlanActivityDueWithinDays: [0, 365],
  birthMonth: [1, 12],
} as const;
const CHOICES = {
  sex: ["male", "female"],
  optedInChannel: ["sms", "email", "push", "in_app"],
  myHealth: ["active", "not_active"],
  identifierOnFile: ["philhealth_pin", "hmo_member_id"],
} as const;
const DATES = ["registeredFrom", "registeredTo", "lastVisitBefore"] as const;
const PLACES = ["cityMunicipality", "province"] as const;

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)?.trim();

export function segmentDraftFrom(params: Params): SegmentDraft | null {
  if (one(params.segment) !== "new") return null;
  const criteria: Record<string, string | number> = {};
  for (const [key, [min, max]] of Object.entries(INTEGERS)) {
    const value = one(params[key]);
    if (value && /^\d{1,3}$/.test(value) && Number(value) >= min && Number(value) <= max) criteria[key] = Number(value);
  }
  for (const [key, allowed] of Object.entries(CHOICES)) {
    const value = one(params[key]);
    if (value && (allowed as readonly string[]).includes(value)) criteria[key] = value;
  }
  for (const key of DATES) {
    const value = one(params[key]);
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) criteria[key] = value;
  }
  for (const key of PLACES) {
    const value = one(params[key]);
    if (value && value.length >= 2 && value.length <= 120) criteria[key] = value;
  }
  const facility = one(params.registeredFacilityId);
  if (facility && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(facility)) criteria.registeredFacilityId = facility;
  return { name: (one(params.name) ?? "").slice(0, 120), criteria: criteria as OutreachSegmentCriteria };
}
