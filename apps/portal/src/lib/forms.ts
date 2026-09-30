import { z } from "zod";
import { ApiError } from "@healthcare/web-session";

/**
 * Form checks run in the portal's server actions before calling the API, so
 * patients get specific, friendly messages. The API validates again and is
 * the authority (password rules: libs/auth/src/lib/password.ts).
 */
const email = z.string().trim().toLowerCase().min(1, "Enter your email address.").email("Enter a valid email address.").max(254);

export const loginFormSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(128),
});

const newPassword = z
  .string()
  .min(12, "Use at least 12 characters for your password.")
  .max(128, "Use at most 128 characters for your password.")
  .refine((v) => new Set(v).size >= 5, "Your password is too repetitive. Mix more different characters.");

export const resetRequestFormSchema = z.object({ email });

export const resetFormSchema = z
  .object({
    token: z.string().trim().min(20, "This link is incomplete. Ask for a new one.").max(200, "This link is not valid. Ask for a new one."),
    birthDate: z.iso.date("Enter your date of birth."),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "The two passwords do not match." });

export const activateFormSchema = z
  .object({
    patientNumber: z.string().trim().toUpperCase().min(1, "Enter your patient number.").max(32, "That patient number is too long."),
    birthDate: z.iso.date("Enter your date of birth."),
    activationCode: z
      .string()
      .transform((v) => v.replace(/[\s-]+/g, "").toUpperCase())
      .pipe(z.string().length(10, "The activation code has 10 letters and numbers.")),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "The two passwords do not match." });

export type FieldErrors = Partial<Record<string, string>>;

/** Parses form values; returns the first message per field on failure. */
export function parseForm<S extends z.ZodType>(
  schema: S,
  form: FormData,
  fields: readonly string[],
): { ok: true; data: z.output<S> } | { ok: false; errors: FieldErrors } {
  const raw = Object.fromEntries(fields.map((f) => [f, String(form.get(f) ?? "")]));
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** A message for patients: plain language, with a support reference when the API gave one. */
export function patientMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "We couldn't reach MyHealth. Check your connection and try again.";
  const ref = error.requestId ? ` (ref ${error.requestId.slice(0, 8)})` : "";
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.code === "validation_failed") return `Some details were not accepted. Check them and try again.${ref}`;
  if (error.status >= 500) return `Something went wrong on our side. Try again in a few minutes.${ref}`;
  return `${error.message}${ref}`;
}
