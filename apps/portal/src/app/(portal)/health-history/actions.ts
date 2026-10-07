"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { PortalHistorySubmission, PortalHistorySubmissionResult } from "@/lib/api/types";
import { PARTIAL_DATE } from "@/lib/health-history";

/**
 * Sends the questionnaire as one submission (the API records each answer as reported by the patient, or by a relative
 * when a guardian with "act" access answers, and refuses future dates, a view-only guardian and more than 10 an hour).
 * The key makes a retried send harmless.
 */
export async function submitHealthHistory(body: PortalHistorySubmission, key?: string): Promise<Result<PortalHistorySubmissionResult>> {
  const idempotencyKey = key && /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : `hh-${randomUUID()}`;
  const result = await run(() =>
    portalApi<PortalHistorySubmissionResult>("/portal/health-history/submissions", { method: "POST", body, headers: { "idempotency-key": idempotencyKey } }),
  );
  if (result.ok) revalidatePath("/health-history");
  return result;
}

/** The patient no longer takes a medicine they reported here (once; the API refuses the clinic's own entries). */
export async function stopReportedMedicine(id: string, stopped: string): Promise<Result<{ id: string; status: "stopped" }>> {
  if (!UUID.test(id)) return { ok: false, message: "Unknown medicine." };
  const when = stopped.trim();
  if (when && !PARTIAL_DATE.test(when)) return { ok: false, message: "Give the year (2019), the month (2019-05) or the day (2019-05-12)." };
  const result = await run(() =>
    portalApi<{ id: string; status: "stopped" }>(`/portal/health-history/medications/${id}/stopped`, { method: "POST", body: when ? { stopped: when } : {} }),
  );
  if (result.ok) revalidatePath("/health-history");
  return result;
}
