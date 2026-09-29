"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { PortalDentalPlan } from "@/lib/api/types";

/** A short-lived link to an X-ray or photo the dentist shared (the API checks it is shared with this patient and audits it). */
export async function openDentalImage(imageId: string): Promise<Result<{ url: string }>> {
  if (!UUID.test(imageId)) return { ok: false, message: "Unknown image." };
  return run(() => portalApi<{ url: string; expiresAt: string }>(`/portal/dental/images/${imageId}/link`));
}

/**
 * Records the patient's decision on the items of a plan awaiting it: the listed ones accepted, the others declined,
 * after they confirmed the clinic's acknowledgement. The API refuses if the clinic does not allow online decisions or
 * the dentist changed the plan since it was shown.
 */
export async function decideDentalPlan(input: { planId: string; acceptedItemIds: string[]; awaitingItemIds: string[] }): Promise<Result<PortalDentalPlan>> {
  if (!UUID.test(input.planId) || ![...input.acceptedItemIds, ...input.awaitingItemIds].every((id) => UUID.test(id))) {
    return { ok: false, message: "Invalid decision." };
  }
  const result = await run(() =>
    portalApi<PortalDentalPlan>(`/portal/dental/plans/${input.planId}/decision`, {
      method: "POST",
      body: { acceptedItemIds: input.acceptedItemIds, awaitingItemIds: input.awaitingItemIds, acknowledged: true },
    }),
  );
  revalidatePath("/dental");
  return result;
}
