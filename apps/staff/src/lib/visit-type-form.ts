import { z } from "zod";

/**
 * The "Add visit type" form on Online booking (`/appointments/visit-types`). The API (`libs/clinic`, `createVisitTypeSchema`)
 * validates and authorizes the call (clinic.configure); this mirrors its limits so the form can fail fast with a field-level
 * message. Codes are what the API accepts: 2–49 lower-case letters, digits or hyphens, trimmed and lower-cased here as there.
 */

export const VISIT_TYPE_MODALITIES = [
  { value: "in_person", label: "In person" },
  { value: "telemedicine", label: "Online (video)" },
] as const;

export type VisitTypeModality = (typeof VISIT_TYPE_MODALITIES)[number]["value"];

export const visitTypeFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Codes use 2–49 lower-case letters, digits or hyphens."),
  name: z.string().trim().min(1, "Name the visit type as staff and patients should see it.").max(120, "Keep the name to 120 characters."),
  defaultDurationMinutes: z.coerce
    .number({ message: "Enter the usual length in minutes." })
    .int("Use whole minutes.")
    .min(5, "A visit lasts at least 5 minutes.")
    .max(480, "A visit lasts at most 8 hours (480 minutes)."),
  modality: z.enum(["in_person", "telemedicine"], { message: "Choose where the visit happens." }),
  requiresTriage: z.boolean(),
  onlineBooking: z.boolean(),
});

export type VisitTypeFormInput = z.input<typeof visitTypeFormSchema>;
export type VisitTypeFormValues = z.output<typeof visitTypeFormSchema>;

/** A fresh form: in person, triage first, staff-only booking — the API's own defaults. */
export const BLANK_VISIT_TYPE: {
  code: string;
  name: string;
  defaultDurationMinutes: string;
  modality: VisitTypeModality;
  requiresTriage: boolean;
  onlineBooking: boolean;
} = { code: "", name: "", defaultDurationMinutes: "15", modality: "in_person", requiresTriage: true, onlineBooking: false };
