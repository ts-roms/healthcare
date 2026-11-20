"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Page, PatientSummary } from "@/lib/api/types";
import type { CommandPatient } from "@/lib/command-bar";

/**
 * The command bar's patient search (Ctrl+K): the ordinary patient search, which checks `patient.search` and audits the
 * search like the top bar's, cut to the fields the command bar shows (no contact details).
 */
export async function findPatientsForCommand(query: string): Promise<ActionResult<CommandPatient[]>> {
  const parsed = z.string().trim().min(3).max(80).safeParse(query);
  if (!parsed.success) return { ok: true, data: [] };
  return actionResult(async () => {
    const page = await api<Page<PatientSummary>>("/patients", { query: { q: parsed.data, pageSize: 5 } });
    return page.items.map(({ id, patientNumber, displayName, sex, age, status }) => ({ id, patientNumber, displayName, sex, age, status }));
  });
}
