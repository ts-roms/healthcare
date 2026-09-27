"use server";

import { unstable_rethrow } from "next/navigation";
import { api } from "@/lib/api/client";
import { ApiError, userMessage } from "@healthcare/web-session";
import type { DuplicateCandidate, RegisteredPatient } from "@/lib/api/types";
import { type DuplicateOverride, fieldErrorsFromApi, type RegistrationForm, registrationFormSchema, toRegisterPayload } from "@/lib/patient-registration";

export type RegisterResult =
  | { ok: true; patient: RegisteredPatient }
  | { ok: false; kind: "duplicates"; candidates: DuplicateCandidate[]; message: string }
  | { ok: false; kind: "invalid"; fieldErrors: Partial<Record<keyof RegistrationForm, string>>; message: string }
  | { ok: false; kind: "error"; message: string };

/**
 * Registers a patient at the selected facility. The idempotency key makes a
 * retried submission safe; the API decides duplicates and audits any override.
 */
export async function registerPatient(form: RegistrationForm, idempotencyKey: string, override?: DuplicateOverride): Promise<RegisterResult> {
  const parsed = registrationFormSchema.safeParse(form);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof RegistrationForm, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof RegistrationForm | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, kind: "invalid", fieldErrors, message: "Check the highlighted fields." };
  }
  try {
    const patient = await api<RegisteredPatient>("/patients", {
      method: "POST",
      body: toRegisterPayload(parsed.data, override),
      idempotencyKey,
    });
    return { ok: true, patient };
  } catch (error) {
    // Let Next's redirect (e.g. the session ended) propagate.
    unstable_rethrow(error);
    if (error instanceof ApiError) {
      const details = error.details as { candidates?: DuplicateCandidate[] } | undefined;
      if ((error.code === "possible_duplicates" || error.code === "identifier_in_use") && details?.candidates?.length) {
        return { ok: false, kind: "duplicates", candidates: details.candidates, message: error.message };
      }
      if (error.code === "validation_failed") {
        return { ok: false, kind: "invalid", fieldErrors: fieldErrorsFromApi(error.details), message: error.message };
      }
      if (error.code === "facility_required") {
        return { ok: false, kind: "error", message: "Select your facility in the top bar before registering a patient." };
      }
    }
    return { ok: false, kind: "error", message: userMessage(error) };
  }
}
