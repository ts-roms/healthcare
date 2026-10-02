"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Page, PatientSummary } from "@/lib/api/types";

/**
 * Resolves a patient number typed on the Offline page to the record it names, at replay time. Exactly one active
 * match or nothing: the outbox parks the action otherwise, and a person decides on the live screen.
 */
export async function findPatientByNumber(patientNumber: string): Promise<ActionResult<{ patientId: string; displayName: string } | null>> {
  const parsed = z.string().trim().min(3).max(40).safeParse(patientNumber);
  if (!parsed.success) return { ok: false, message: "Enter a patient number." };
  return actionResult(async () => {
    const page = await api<Page<PatientSummary>>("/patients", { query: { q: parsed.data, pageSize: 5 } });
    const exact = page.items.filter((p) => p.patientNumber.toLowerCase() === parsed.data.toLowerCase() && p.status === "active");
    return exact.length === 1 ? { patientId: exact[0]!.id, displayName: exact[0]!.displayName } : null;
  });
}
