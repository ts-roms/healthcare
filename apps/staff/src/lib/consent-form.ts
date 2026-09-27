import { z } from "zod";

/**
 * Staff consent recording. The consent types, decisions and capture methods
 * mirror `libs/patient` (`patient.schema.ts`); the API validates again and is
 * authoritative. Consents are append-only: a new decision supersedes the
 * previous one for that type, and the history is kept.
 */
export const CONSENT_TYPES = {
  data_processing: { label: "Processing of personal data", hint: "Collecting and using the patient's information for their care and the clinic's records." },
  treatment_general: { label: "General consent to treatment", hint: "Routine examination and treatment at this clinic." },
  telemedicine: { label: "Telemedicine consultations", hint: "Consultations by video or phone." },
  data_sharing_hmo: { label: "Sharing data with HMO", hint: "Sending records needed for HMO approval and billing." },
  data_sharing_philhealth: { label: "Sharing data with PhilHealth", hint: "Sending records needed for PhilHealth claims." },
  portal_access: { label: "Patient portal access (MyHealth)", hint: "Using MyHealth to see their own information. Needed before a portal invitation." },
  research: { label: "Use of data for research", hint: "Use of the patient's information in approved research." },
} as const;

export const CONSENT_DECISIONS = {
  granted: "Granted",
  refused: "Refused",
  withdrawn: "Withdrawn",
} as const;

export const CONSENT_CAPTURE = {
  paper: "Signed paper form",
  electronic: "Electronic signature",
  verbal: "Verbal (witnessed by staff)",
} as const;

export type ConsentType = keyof typeof CONSENT_TYPES;

export function consentTypeLabel(type: string): string {
  return CONSENT_TYPES[type as ConsentType]?.label ?? type.replace(/_/g, " ");
}

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

/** Today's calendar date in the Philippines (YYYY-MM-DD). */
export function todayInManila(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface ConsentForm {
  consentType: string;
  decision: string;
  capturedVia: string;
  /** Optional last day the consent applies (YYYY-MM-DD, Philippine date). */
  expiresOn: string;
  notes: string;
}

export const EMPTY_CONSENT_FORM: ConsentForm = { consentType: "", decision: "granted", capturedVia: "paper", expiresOn: "", notes: "" };

export function consentFormSchema(today: string) {
  return z
    .object({
      consentType: z.enum(keys(CONSENT_TYPES), "Choose the consent."),
      decision: z.enum(keys(CONSENT_DECISIONS), "Choose the patient's decision."),
      capturedVia: z.enum(keys(CONSENT_CAPTURE), "Choose how the consent was given."),
      expiresOn: z.union([z.literal(""), z.iso.date("Enter a valid date.")]),
      notes: z.string().trim().max(1000, "Keep notes under 1,000 characters."),
    })
    .refine((v) => v.expiresOn === "" || v.expiresOn > today, { path: ["expiresOn"], message: "The end date must be after today." })
    .refine((v) => v.expiresOn === "" || v.decision === "granted", { path: ["expiresOn"], message: "Only a granted consent can have an end date." });
}

export interface ConsentPayload {
  consentType: ConsentType;
  decision: keyof typeof CONSENT_DECISIONS;
  capturedVia: keyof typeof CONSENT_CAPTURE;
  expiresAt?: string;
  notes?: string;
}

/** Validates the form. The consent takes effect when recorded; an end date runs to the end of that day in Manila. */
export function parseConsentForm(
  form: ConsentForm,
  today: string = todayInManila(),
): { ok: true; payload: ConsentPayload } | { ok: false; errors: Partial<Record<keyof ConsentForm, string>> } {
  const result = consentFormSchema(today).safeParse(form);
  if (!result.success) {
    const errors: Partial<Record<keyof ConsentForm, string>> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof ConsentForm | undefined;
      if (key && !errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }
  const { consentType, decision, capturedVia, expiresOn, notes } = result.data;
  return {
    ok: true,
    payload: {
      consentType,
      decision,
      capturedVia,
      expiresAt: expiresOn ? `${expiresOn}T23:59:59+08:00` : undefined,
      notes: notes || undefined,
    },
  };
}

export type ConsentState = "in_effect" | "expired" | "not_yet_effective" | "refused" | "withdrawn";

/** Whether a (latest) consent decision currently applies. */
export function consentState(c: { decision: string; effectiveAt: string; expiresAt: string | null }, now: Date = new Date()): ConsentState {
  if (c.decision === "refused") return "refused";
  if (c.decision === "withdrawn") return "withdrawn";
  if (new Date(c.effectiveAt) > now) return "not_yet_effective";
  if (c.expiresAt && new Date(c.expiresAt) <= now) return "expired";
  return "in_effect";
}

/** Signed consent forms: scans and phone photos. The API accepts more formats; staff uploads are limited to these. */
export const CONSENT_FILE_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/heic": "HEIC",
};

/** Uploads pass through the staff app's server (see next.config.ts), so they are capped below its request limit. */
export const MAX_CONSENT_FILE_BYTES = 10 * 1024 * 1024;

/** A problem with the chosen file, or null when it can be uploaded. */
export function checkConsentFile(file: { name: string; type: string; size: number }): string | null {
  if (file.size === 0) return "The file is empty.";
  if (!CONSENT_FILE_TYPES[file.type]) return "Attach a PDF or a photo (JPEG, PNG or HEIC).";
  if (file.size > MAX_CONSENT_FILE_BYTES) return "The file is larger than 10 MB. Scan at a lower resolution or attach a PDF.";
  if (/[\\/\0]/.test(file.name) || file.name.length > 200) return "Rename the file (no slashes, at most 200 characters).";
  return null;
}

/** Document title for a signed form, e.g. "Signed consent: Patient portal access (MyHealth)". */
export function consentDocumentTitle(consentType: string): string {
  return `Signed consent: ${consentTypeLabel(consentType)}`;
}
