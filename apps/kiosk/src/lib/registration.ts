import { z } from "zod";
import { toIsoDate } from "./birth-date";

export const SEXES = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "intersex", label: "Intersex" },
  { value: "unknown", label: "Prefer not to say" },
] as const;

export const CIVIL_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "widowed", label: "Widowed" },
  { value: "separated", label: "Separated" },
  { value: "annulled", label: "Annulled" },
] as const;

/** The relationships the patient record accepts for an emergency contact (the API validates the same list). */
export const RELATIONSHIPS = [
  { value: "mother", label: "Mother" },
  { value: "father", label: "Father" },
  { value: "parent", label: "Parent" },
  { value: "spouse", label: "Spouse" },
  { value: "partner", label: "Partner" },
  { value: "child", label: "Son or daughter" },
  { value: "sibling", label: "Brother or sister" },
  { value: "guardian", label: "Guardian" },
  { value: "other", label: "Someone else" },
] as const;

const text = (label: string, max = 100) =>
  z
    .string()
    .trim()
    .min(1, `Please enter ${label}`)
    .max(max, `${label[0]?.toUpperCase()}${label.slice(1)} is too long`);
const optional = (max: number) => z.string().trim().max(max).optional();

/** A Philippine mobile number as people write it: 09171234567, +63 917 123 4567, 0917-123-4567. */
export const normalizeMobile = (value: string): string | null => {
  const digits = value.replace(/[\s()-]/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^\+639\d{9}$/.test(digits)) return digits;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return null;
};

export const registrationForm = z.object({
  familyName: text("your family name (surname)"),
  givenName: text("your first name"),
  middleName: optional(100),
  sex: z.enum(["female", "male", "intersex", "unknown"], { error: "Please choose one" }),
  birthDay: z.string(),
  birthMonth: z.string(),
  birthYear: z.string(),
  civilStatus: z.enum(["", "single", "married", "widowed", "separated", "annulled"]).optional(),
  mobile: z
    .string()
    .trim()
    .refine((v) => normalizeMobile(v) !== null, "Enter a mobile number such as 0917 123 4567"),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter an email address such as name@example.com")
    .optional(),
  line1: optional(300),
  barangay: optional(120),
  cityMunicipality: text("your city or municipality", 120),
  province: optional(120),
  postalCode: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}$/.test(v), "A postal code has 4 digits")
    .optional(),
  philhealthPin: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[\d-]{9,16}$/.test(v), "Check the PhilHealth number, or leave it empty")
    .optional(),
  emergencyName: text("the name of your emergency contact", 200),
  emergencyNumber: z.string().trim().min(7, "Please enter a phone number").max(40),
  emergencyRelationship: z.enum(RELATIONSHIPS.map((r) => r.value) as [string, ...string[]], { error: "Please choose one" }),
  privacyAcknowledged: z.literal(true, { error: "Please tick the box to continue" }),
});

export type RegistrationForm = z.infer<typeof registrationForm>;

export const EMPTY_REGISTRATION: Partial<RegistrationForm> = {
  familyName: "",
  givenName: "",
  middleName: "",
  birthDay: "",
  birthMonth: "",
  birthYear: "",
  civilStatus: "",
  mobile: "",
  email: "",
  line1: "",
  barangay: "",
  cityMunicipality: "",
  province: "",
  postalCode: "",
  philhealthPin: "",
  emergencyName: "",
  emergencyNumber: "",
};

const clean = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== "" && v !== undefined)) as T;

/**
 * What the kiosk sends: the API's registration shape (`POST /kiosk/registrations`). Empty optional fields are left out,
 * the mobile number is written in international form, and nothing the patient did not type is invented.
 */
export function toRegistrationPayload(form: RegistrationForm, today: string) {
  const birthDate = toIsoDate({ day: form.birthDay, month: form.birthMonth, year: form.birthYear }, today);
  if (!birthDate) throw new Error("birth date is not valid");
  const email = form.email?.trim();
  return {
    familyName: form.familyName.trim(),
    givenName: form.givenName.trim(),
    ...clean({ middleName: form.middleName?.trim(), civilStatus: form.civilStatus }),
    sex: form.sex,
    birthDate,
    contacts: [
      { system: "mobile" as const, value: normalizeMobile(form.mobile) as string, use: "personal" as const, isPrimary: true },
      ...(email ? [{ system: "email" as const, value: email, use: "personal" as const }] : []),
    ],
    addresses: [
      {
        use: "home" as const,
        isPrimary: true,
        cityMunicipality: form.cityMunicipality.trim(),
        ...clean({ line1: form.line1?.trim(), barangay: form.barangay?.trim(), province: form.province?.trim(), postalCode: form.postalCode?.trim() }),
      },
    ],
    identifiers: form.philhealthPin?.trim() ? [{ type: "philhealth_pin" as const, value: form.philhealthPin.trim() }] : [],
    emergencyContact: { name: form.emergencyName.trim(), contactNumber: form.emergencyNumber.trim(), relationship: form.emergencyRelationship },
    privacyAcknowledged: true as const,
  };
}

export type RegistrationPayload = ReturnType<typeof toRegistrationPayload>;
