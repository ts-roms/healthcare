import { z } from "zod";

// Staff forms for correcting a patient's record. The API re-validates everything and audits each change; these give
// fast, field-level feedback and shape the payloads. Contacts, addresses, identifiers and relationships are never
// edited in place: a wrong one is removed (kept in history with the reason) and the right one added.

export const SEX_OPTIONS = ["female", "male", "intersex", "unknown"] as const;
export const CIVIL_STATUS_OPTIONS = ["single", "married", "widowed", "separated", "annulled", "unknown"] as const;
export const CONTACT_SYSTEM_OPTIONS = ["mobile", "phone", "email"] as const;
export const CONTACT_USE_OPTIONS = ["personal", "home", "work", "other"] as const;
export const ADDRESS_USE_OPTIONS = ["home", "work", "temporary", "billing", "other"] as const;
export const IDENTIFIER_TYPE_OPTIONS = [
  "philhealth_pin",
  "philsys_number",
  "senior_citizen_id",
  "pwd_id",
  "passport",
  "drivers_license",
  "hmo_member_id",
  "external_mrn",
  "other",
] as const;
export const RELATIONSHIP_OPTIONS = [
  "mother",
  "father",
  "parent",
  "spouse",
  "partner",
  "child",
  "sibling",
  "guardian",
  "grandparent",
  "grandchild",
  "relative",
  "friend",
  "other",
] as const;
/** Channels a patient chooses (in-app messages in MyHealth always follow the portal account, as in MyHealth's own settings). */
export const COMMUNICATION_CHANNEL_OPTIONS = ["sms", "email", "push"] as const;
export const COMMUNICATION_CATEGORY_OPTIONS = ["clinical", "administrative", "outreach"] as const;

/** Identifier types whose issuer (HMO, facility) the API requires. */
export const IDENTIFIER_NEEDS_ISSUER: readonly string[] = ["hmo_member_id", "external_mrn"];

const blank = (v: string | undefined | null) => (v && v.trim() ? v.trim() : undefined);
const reason = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500);
const optionalReason = z.string().trim().max(500).optional();

export const demographicsFormSchema = z.object({
  familyName: z.string().trim().min(1, "Required").max(100),
  givenName: z.string().trim().min(1, "Required").max(100),
  middleName: z.string().trim().max(100),
  suffix: z.string().trim().max(20),
  sex: z.enum(SEX_OPTIONS, { message: "Select sex" }),
  genderIdentity: z.string().trim().max(60),
  birthDate: z.iso.date("Enter a valid date"),
  birthDateIsEstimated: z.boolean(),
  civilStatus: z.enum(CIVIL_STATUS_OPTIONS).or(z.literal("")),
  nationality: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/, "Use a 2-letter country code, e.g. PH"),
  occupation: z.string().trim().max(120),
  reason: optionalReason,
});
export type DemographicsForm = z.input<typeof demographicsFormSchema>;

type DemographicsCurrent = {
  familyName: string;
  givenName: string;
  middleName: string | null;
  suffix: string | null;
  sex: string;
  genderIdentity: string | null;
  birthDate: string;
  birthDateIsEstimated: boolean;
  civilStatus: string | null;
  nationality: string | null;
  occupation: string | null;
};

export function demographicsFormFrom(p: DemographicsCurrent): DemographicsForm {
  return {
    familyName: p.familyName,
    givenName: p.givenName,
    middleName: p.middleName ?? "",
    suffix: p.suffix ?? "",
    sex: (SEX_OPTIONS as readonly string[]).includes(p.sex) ? (p.sex as DemographicsForm["sex"]) : "unknown",
    genderIdentity: p.genderIdentity ?? "",
    birthDate: p.birthDate,
    birthDateIsEstimated: p.birthDateIsEstimated,
    civilStatus: (p.civilStatus ?? "") as DemographicsForm["civilStatus"],
    nationality: p.nationality ?? "",
    occupation: p.occupation ?? "",
    reason: "",
  };
}

/**
 * Only the fields that changed (the API audits each one), with cleared optional fields sent as null. Null when nothing
 * changed.
 */
export function demographicsPatch(current: DemographicsCurrent, form: z.output<typeof demographicsFormSchema>, version: number) {
  const next: Record<string, unknown> = {
    familyName: form.familyName,
    givenName: form.givenName,
    middleName: blank(form.middleName) ?? null,
    suffix: blank(form.suffix) ?? null,
    sex: form.sex,
    genderIdentity: blank(form.genderIdentity) ?? null,
    birthDate: form.birthDate,
    birthDateIsEstimated: form.birthDateIsEstimated,
    civilStatus: form.civilStatus || null,
    nationality: form.nationality || null,
    occupation: blank(form.occupation) ?? null,
  };
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if ((current as Record<string, unknown>)[key] !== value) changes[key] = value;
  }
  if (Object.keys(changes).length === 0) return null;
  // Required fields are never sent as null.
  for (const key of ["familyName", "givenName", "sex", "birthDate", "birthDateIsEstimated"]) if (changes[key] === null) delete changes[key];
  return { ...changes, version, ...(blank(form.reason) ? { reason: blank(form.reason) } : {}) };
}

export const statusFormSchema = z
  .object({
    status: z.enum(["active", "inactive", "deceased"]),
    /** A local date and time (datetime-local) in the facility's time zone; required for deceased. */
    deceasedAt: z.string().trim().optional(),
    reason,
  })
  .refine((v) => v.status !== "deceased" || Boolean(v.deceasedAt), { path: ["deceasedAt"], message: "Enter the date and time of death." });

export const contactFormSchema = z
  .object({
    system: z.enum(CONTACT_SYSTEM_OPTIONS),
    value: z.string().trim().min(3, "Enter the number or address.").max(254),
    use: z.enum(CONTACT_USE_OPTIONS),
    isPrimary: z.boolean(),
  })
  .refine((v) => v.system !== "mobile" || /^(\+?63|0)?9\d{9}$/.test(v.value.replace(/[\s-]/g, "")), {
    path: ["value"],
    message: "Enter a PH mobile number, e.g. 0917 123 4567",
  })
  .refine((v) => v.system !== "email" || z.email().safeParse(v.value).success, { path: ["value"], message: "Enter a valid email" });

export function contactPayload(form: z.output<typeof contactFormSchema>) {
  return { ...form, value: form.system === "mobile" ? form.value.replace(/[\s-]/g, "") : form.value };
}

export const addressFormSchema = z.object({
  use: z.enum(ADDRESS_USE_OPTIONS),
  line1: z.string().trim().max(300),
  barangay: z.string().trim().max(120),
  cityMunicipality: z.string().trim().min(1, "Enter the city or municipality.").max(120),
  province: z.string().trim().max(120),
  postalCode: z
    .string()
    .trim()
    .regex(/^(\d{4})?$/, "Philippine postal codes have 4 digits"),
  isPrimary: z.boolean(),
});

export function addressPayload(form: z.output<typeof addressFormSchema>) {
  return {
    use: form.use,
    line1: blank(form.line1),
    barangay: blank(form.barangay),
    cityMunicipality: form.cityMunicipality,
    province: blank(form.province),
    postalCode: blank(form.postalCode),
    isPrimary: form.isPrimary,
  };
}

export const identifierFormSchema = z
  .object({
    type: z.enum(IDENTIFIER_TYPE_OPTIONS, { message: "Choose the kind of ID." }),
    value: z.string().trim().min(1, "Enter the number.").max(64),
    issuer: z.string().trim().max(120),
    validUntil: z.string().trim(),
  })
  .refine((v) => !IDENTIFIER_NEEDS_ISSUER.includes(v.type) || Boolean(v.issuer), { path: ["issuer"], message: "Name the HMO or facility that issued it." })
  .refine((v) => v.type !== "philhealth_pin" || /^\d{2}-?\d{9}-?\d$/.test(v.value), { path: ["value"], message: "PhilHealth PIN has 12 digits" })
  .refine((v) => !v.validUntil || /^\d{4}-\d{2}-\d{2}$/.test(v.validUntil), { path: ["validUntil"], message: "Enter a valid date" });

export function identifierPayload(form: z.output<typeof identifierFormSchema>) {
  return {
    type: form.type,
    value: form.type === "philhealth_pin" ? form.value.replace(/-/g, "") : form.value,
    issuer: blank(form.issuer),
    validUntil: blank(form.validUntil),
  };
}

export const relationshipFormSchema = z.object({
  relationship: z.enum(RELATIONSHIP_OPTIONS, { message: "Choose the relationship." }),
  name: z.string().trim().min(1, "Enter the person's name.").max(200),
  contactNumber: z.string().trim().max(40),
  isEmergencyContact: z.boolean(),
  isLegalGuardian: z.boolean(),
  notes: z.string().trim().max(500),
});

export function relationshipPayload(form: z.output<typeof relationshipFormSchema>) {
  return {
    relationship: form.relationship,
    name: form.name,
    contactNumber: blank(form.contactNumber),
    isEmergencyContact: form.isEmergencyContact,
    isLegalGuardian: form.isLegalGuardian,
    notes: blank(form.notes),
  };
}

export const retireReasonSchema = reason;

export type PreferenceKey = `${(typeof COMMUNICATION_CHANNEL_OPTIONS)[number]}:${(typeof COMMUNICATION_CATEGORY_OPTIONS)[number]}`;

/** Without a recorded choice, care-related messages are sent and outreach is not (the notification service's rule). */
export function defaultOptedIn(category: string): boolean {
  return category !== "outreach";
}

/** The choice in force for each channel and category: the recorded one, else the default. */
export function effectivePreferences(recorded: Array<{ channel: string; category: string; optedIn: boolean }>): Record<string, boolean> {
  const current = new Map(recorded.map((p) => [`${p.channel}:${p.category}`, p.optedIn]));
  const out: Record<string, boolean> = {};
  for (const channel of COMMUNICATION_CHANNEL_OPTIONS) {
    for (const category of COMMUNICATION_CATEGORY_OPTIONS) out[`${channel}:${category}`] = current.get(`${channel}:${category}`) ?? defaultOptedIn(category);
  }
  return out;
}

/** Only the channel/category pairs whose choice differs from the one in force. Null when nothing changed. */
export function preferencesPayload(recorded: Array<{ channel: string; category: string; optedIn: boolean }>, chosen: Record<string, boolean>) {
  const current = new Map(recorded.map((p) => [`${p.channel}:${p.category}`, p.optedIn]));
  const preferences = Object.entries(chosen)
    .filter(([key, optedIn]) => (current.get(key) ?? defaultOptedIn(key.split(":")[1] ?? "")) !== optedIn)
    .map(([key, optedIn]) => {
      const [channel, category] = key.split(":");
      return { channel, category, optedIn };
    });
  return preferences.length ? { preferences } : null;
}

/** The first message per field, for inline errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
