"use server";

import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { forwardedHeaders } from "@healthcare/web-session";
import { API_BASE_URL, COOKIES, REALTIME_URL } from "@/lib/api/config";
import { portalApi } from "@/lib/api/client";
import { run, type Result } from "@/lib/api/result";
import { clearSessionCookies } from "@/lib/api/tokens";

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const accessToken = jar.get(COOKIES.access)?.value;
  if (accessToken) {
    // Revoke the portal session server-side; clear cookies regardless of the outcome.
    await fetch(`${API_BASE_URL}/portal/auth/logout`, {
      method: "POST",
      headers: { ...forwardedHeaders(await requestHeaders()), authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }).catch(() => undefined);
  }
  clearSessionCookies(jar);
  redirect("/login?reason=signed_out");
}

/**
 * A 60-second ticket and the address of the realtime socket, so a patient's open page hears of a new message at once. The
 * browser never holds an access token: the ticket only opens the socket and the API re-checks the session on connect. It is
 * always the account holder's own (never sent as someone acting for another person).
 */
export async function realtimeTicket(): Promise<Result<{ url: string; ticket: string }>> {
  return run(async () => {
    const { ticket } = await portalApi<{ ticket: string; expiresInSeconds: number }>("/portal/realtime-tickets", {
      method: "POST",
      body: {},
      headers: { "x-acting-for": "" },
    });
    return { url: REALTIME_URL, ticket };
  });
}
