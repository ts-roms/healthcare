"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { getSelectedFacility } from "@/lib/api/session";
import type { PatientDetail } from "@/lib/api/types";
import { zonedLocalToIso } from "@/lib/clinic-mapping";
import {
  addressFormSchema,
  addressPayload,
  contactFormSchema,
  contactPayload,
  demographicsFormSchema,
  demographicsPatch,
  fieldErrors,
  identifierFormSchema,
  identifierPayload,
  preferencesPayload,
  relationshipFormSchema,
  relationshipPayload,
  retireReasonSchema,
  statusFormSchema,
} from "@/lib/patient-edit";

// Corrections to a patient's record. Shapes are checked here to fail fast; the API authorizes (patient.update, or
// patient.consent.manage for communication preferences), checks the record's version, refuses merged records and
// audits each change with the reason given.

export type FormResult = ActionResult & { fieldErrors?: Record<string, string> };

function invalid(error: z.ZodError): FormResult {
  return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(error) };
}

function refresh(patientId: string) {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/edit`);
}

async function done(patientId: string, call: () => Promise<unknown>): Promise<FormResult> {
  const result = await actionResult(call);
  if (!result.ok) return result;
  refresh(patientId);
  return { ok: true, data: null };
}

/**
 * `current` is the record as the page showed it; the API compares with the stored record anyway (unchanged fields are
 * not recorded as changes) and the version makes a change made meanwhile fail instead of being overwritten.
 */
export async function updateDemographics(
  patientId: string,
  current: Parameters<typeof demographicsPatch>[0],
  version: number,
  input: z.input<typeof demographicsFormSchema>,
): Promise<FormResult> {
  const parsed = demographicsFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const patch = demographicsPatch(current, parsed.data, version);
  if (!patch) return { ok: false, message: "Nothing changed." };
  return done(patientId, () => api(`/patients/${patientId}`, { method: "PATCH", body: patch }));
}

export async function changeStatus(patientId: string, version: number, input: z.input<typeof statusFormSchema>): Promise<FormResult> {
  const parsed = statusFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  let deceasedAt: string | undefined;
  if (parsed.data.status === "deceased" && parsed.data.deceasedAt) {
    const facility = await getSelectedFacility();
    try {
      deceasedAt = zonedLocalToIso(parsed.data.deceasedAt, facility?.timezone ?? "Asia/Manila");
    } catch {
      return { ok: false, message: "Check the highlighted fields.", fieldErrors: { deceasedAt: "Enter the date and time of death." } };
    }
    if (new Date(deceasedAt) > new Date())
      return { ok: false, message: "Check the highlighted fields.", fieldErrors: { deceasedAt: "This is in the future." } };
  }
  return done(patientId, () =>
    api(`/patients/${patientId}/status`, { method: "POST", body: { status: parsed.data.status, deceasedAt, reason: parsed.data.reason, version } }),
  );
}

export async function addContact(patientId: string, input: z.input<typeof contactFormSchema>): Promise<FormResult> {
  const parsed = contactFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return done(patientId, () => api(`/patients/${patientId}/contacts`, { method: "POST", body: contactPayload(parsed.data) }));
}

export async function addAddress(patientId: string, input: z.input<typeof addressFormSchema>): Promise<FormResult> {
  const parsed = addressFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return done(patientId, () => api(`/patients/${patientId}/addresses`, { method: "POST", body: addressPayload(parsed.data) }));
}

export async function addIdentifier(patientId: string, input: z.input<typeof identifierFormSchema>): Promise<FormResult> {
  const parsed = identifierFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return done(patientId, () => api(`/patients/${patientId}/identifiers`, { method: "POST", body: identifierPayload(parsed.data) }));
}

export async function addRelationship(patientId: string, input: z.input<typeof relationshipFormSchema>): Promise<FormResult> {
  const parsed = relationshipFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return done(patientId, () => api(`/patients/${patientId}/relationships`, { method: "POST", body: relationshipPayload(parsed.data) }));
}

const COLLECTIONS = ["contacts", "addresses", "identifiers", "relationships"] as const;

/** Removes a contact, address, identifier or relationship; it stays in the record's history with the reason. */
export async function removeEntry(patientId: string, collection: (typeof COLLECTIONS)[number], recordId: string, why: string): Promise<FormResult> {
  if (!COLLECTIONS.includes(collection)) return { ok: false, message: "Unknown entry." };
  const parsed = retireReasonSchema.safeParse(why);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  return done(patientId, () => api(`/patients/${patientId}/${collection}/${recordId}`, { method: "DELETE", body: { reason: parsed.data } }));
}

export async function setPreferences(
  patientId: string,
  recorded: PatientDetail["communicationPreferences"],
  chosen: Record<string, boolean>,
): Promise<FormResult> {
  const payload = preferencesPayload(recorded, chosen);
  if (!payload) return { ok: false, message: "Nothing changed." };
  return done(patientId, () => api(`/patients/${patientId}/communication-preferences`, { method: "PUT", body: payload }));
}
