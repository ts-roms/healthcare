"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import { SECURE_COOKIES } from "@/lib/api/config";
import type { PortalDependent } from "@/lib/api/types";
import { ACTING_COOKIE } from "@/lib/proxy-access";

/** Starts acting for a person the account holder has access to (the API checks the grant on every request). */
export async function actFor(patientId: string): Promise<Result<never>> {
  if (!UUID.test(patientId)) return { ok: false, message: "Choose a person from the list." };
  const listed = await run(() => portalApi<PortalDependent[]>("/portal/proxy/dependents"));
  if (!listed.ok) return listed;
  if (!listed.data.some((d) => d.patientId === patientId)) return { ok: false, message: "You cannot act for this person any more." };
  (await cookies()).set(ACTING_COOKIE, patientId, { httpOnly: true, sameSite: "lax", secure: SECURE_COOKIES, path: "/" });
  redirect("/");
}

/** Back to the account holder's own MyHealth. */
export async function backToMyself(): Promise<void> {
  (await cookies()).delete(ACTING_COOKIE);
  redirect("/people");
}

/** Ends a grant from MyHealth: the person acted for takes access back, or the guardian gives it up. */
export async function endAccess(grantId: string): Promise<Result<undefined>> {
  if (!UUID.test(grantId)) return { ok: false, message: "Choose a person from the list." };
  const result = await run(() => portalApi<undefined>(`/portal/proxy/grants/${grantId}/end`, { method: "POST" }));
  if (result.ok) revalidatePath("/people");
  return result;
}
