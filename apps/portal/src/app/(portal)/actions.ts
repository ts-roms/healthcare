"use server";

import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { forwardedHeaders } from "@healthcare/web-session";
import { API_BASE_URL, COOKIES } from "@/lib/api/config";
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
