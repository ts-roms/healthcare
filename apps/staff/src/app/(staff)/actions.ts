"use server";

import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { API_BASE_URL, COOKIES, SECURE_COOKIES } from "@/lib/api/config";
import { forwardedHeaders } from "@/lib/api/forwarding";
import { getFacilities } from "@/lib/api/session";
import { clearSessionCookies } from "@/lib/api/tokens";

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const accessToken = jar.get(COOKIES.access)?.value;
  if (accessToken) {
    // Revoke the session server-side; clear cookies regardless of the outcome.
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      headers: { ...forwardedHeaders(await requestHeaders()), authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }).catch(() => undefined);
  }
  clearSessionCookies(jar);
  jar.delete(COOKIES.facility);
  redirect("/login");
}

/** Selects the facility sent as X-Facility-Id. Only facilities the API lists for this organization are accepted. */
export async function selectFacility(facilityId: string): Promise<void> {
  const facilities = await getFacilities();
  if (!facilities.some((f) => f.id === facilityId)) throw new Error("Unknown facility");
  (await cookies()).set(COOKIES.facility, facilityId, { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/" });
}
