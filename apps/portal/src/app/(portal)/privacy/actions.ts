"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalApi } from "@/lib/api/client";
import { type Result, run } from "@/lib/api/result";
import type { ConsentType, PortalConsentDecision } from "@/lib/api/types";
import { clearSessionCookies } from "@/lib/api/tokens";

const GIVABLE: readonly ConsentType[] = ["telemedicine", "data_sharing_hmo", "data_sharing_philhealth", "research"];
const WITHDRAWABLE: readonly ConsentType[] = ["telemedicine", "data_sharing_hmo", "data_sharing_philhealth", "research", "portal_access"];

/**
 * Withdraws a consent MyHealth offers (the API re-checks which, and that it is currently given). Withdrawing MyHealth
 * itself ends every session of the account, so this one's cookies are cleared and the patient lands on sign-in.
 */
export async function withdrawConsent(consentType: ConsentType): Promise<Result<PortalConsentDecision>> {
  if (!WITHDRAWABLE.includes(consentType)) return { ok: false, message: "This consent is withdrawn at the clinic." };
  const result = await run(() => portalApi<PortalConsentDecision>(`/portal/consents/${consentType}/withdraw`, { method: "POST" }));
  if (result.ok && consentType === "portal_access") {
    clearSessionCookies(await cookies());
    redirect("/login?reason=access_withdrawn");
  }
  revalidatePath("/privacy");
  return result;
}

/** Gives a consent the clinic offers online, having read its wording (the API checks the version is still the current one). */
export async function giveConsent(consentType: ConsentType, consentTextId: string): Promise<Result<PortalConsentDecision>> {
  if (!GIVABLE.includes(consentType)) return { ok: false, message: "This consent is given at the clinic." };
  const result = await run(() =>
    portalApi<PortalConsentDecision>(`/portal/consents/${consentType}/give`, { method: "POST", body: { consentTextId, acknowledged: true } }),
  );
  if (result.ok) revalidatePath("/privacy");
  return result;
}
