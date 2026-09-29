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
  jar.delete(COOKIES.timeZone);
  redirect("/login");
}

/** Selects the facility sent as X-Facility-Id (and remembers its time zone for showing times). Only facilities the API lists for this organization are accepted. */
export async function selectFacility(facilityId: string): Promise<void> {
  const facility = (await getFacilities()).find((f) => f.id === facilityId);
  if (!facility) throw new Error("Unknown facility");
  const jar = await cookies();
  jar.set(COOKIES.facility, facility.id, { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/" });
  jar.set(COOKIES.timeZone, facility.timezone, { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/" });
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
