import { z } from "zod";

/** Staff registration form. The API re-validates everything; this gives fast, field-level feedback. */
export const registrationFormSchema = z.object({
  familyName: z.string().trim().min(1, "Required").max(100),
  givenName: z.string().trim().min(1, "Required").max(100),
  middleName: z.string().trim().max(100).optional(),
  suffix: z.string().trim().max(20).optional(),
  sex: z.enum(["female", "male", "intersex", "unknown"], { message: "Select sex" }),
  birthDate: z.iso.date("Enter a valid date").refine((d) => d <= new Date().toISOString().slice(0, 10), "Birth date cannot be in the future"),
  birthDateIsEstimated: z.boolean().optional(),
  mobile: z
    .string()
    .trim()
    .regex(/^(\+?63|0)?9\d{9}$/, "Enter a PH mobile number, e.g. 0917 123 4567")
    .or(z.literal(""))
    .optional(),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  philhealthPin: z
    .string()
    .trim()
    .regex(/^\d{2}-?\d{9}-?\d$/, "PhilHealth PIN has 12 digits")
    .or(z.literal(""))
    .optional(),
  cityMunicipality: z.string().trim().max(120).optional(),
  barangay: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
});

export type RegistrationForm = z.infer<typeof registrationFormSchema>;

export interface DuplicateOverride {
  reviewedCandidateIds: string[];
  reason: string;
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** Maps the form to the API's RegisterPatient payload (only non-empty sub-records). */
export function toRegisterPayload(form: RegistrationForm, duplicateOverride?: DuplicateOverride) {
  const mobile = blank(form.mobile)?.replace(/\s|-/g, "");
  const email = blank(form.email);
  const pin = blank(form.philhealthPin)?.replace(/-/g, "");
  const city = blank(form.cityMunicipality);
  return {
    familyName: form.familyName.trim(),
    givenName: form.givenName.trim(),
    middleName: blank(form.middleName),
    suffix: blank(form.suffix),
    sex: form.sex,
    birthDate: form.birthDate,
    birthDateIsEstimated: form.birthDateIsEstimated || undefined,
    contacts: [
      ...(mobile ? [{ system: "mobile" as const, value: mobile, use: "personal" as const, isPrimary: true }] : []),
      ...(email ? [{ system: "email" as const, value: email, use: "personal" as const, isPrimary: !mobile }] : []),
    ],
    addresses: city ? [{ use: "home" as const, cityMunicipality: city, barangay: blank(form.barangay), province: blank(form.province), isPrimary: true }] : [],
    identifiers: pin ? [{ type: "philhealth_pin" as const, value: pin }] : [],
    ...(duplicateOverride ? { duplicateOverride } : {}),
  };
}

/** Maps API validation details (`[{ path: "contacts.0.value", message }]`) onto form fields. */
export function fieldErrorsFromApi(details: unknown): Partial<Record<keyof RegistrationForm, string>> {
  if (!Array.isArray(details)) return {};
  const out: Partial<Record<keyof RegistrationForm, string>> = {};
  for (const d of details as { path?: string; message?: string }[]) {
    const path = d.path ?? "";
    const message = d.message ?? "Invalid value";
    const field: keyof RegistrationForm | undefined = path.startsWith("contacts")
      ? "mobile"
      : path.startsWith("identifiers")
        ? "philhealthPin"
        : path.startsWith("addresses")
          ? "cityMunicipality"
          : (["familyName", "givenName", "middleName", "suffix", "sex", "birthDate"] as const).find((f) => path === f);
    if (field && !out[field]) out[field] = message;
  }
  return out;
}
