"use server";

import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { API_BASE_URL, COOKIES, REALTIME_URL, SECURE_COOKIES } from "@/lib/api/config";
import { forwardedHeaders } from "@healthcare/web-session";
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

/**
 * A 60-second ticket for the realtime socket, bound to this session and the
 * selected facility. The access token stays in the httpOnly cookie; the
 * browser only ever holds the ticket.
 */
export async function realtimeTicket(): Promise<ActionResult<{ url: string; ticket: string }>> {
  return actionResult(async () => {
    const { ticket } = await api<{ ticket: string; expiresInSeconds: number }>("/auth/realtime-tickets", { method: "POST" });
    return { url: REALTIME_URL, ticket };
  });
}
