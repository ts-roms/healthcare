"use server";

import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { forwardedHeaders, toApiError, type SessionTokens } from "@healthcare/web-session";
import { API_BASE_URL, COOKIES, SECURE_COOKIES } from "@/lib/config";
import { clearSessionCookies, writeTokenCookies } from "@/lib/tokens";

export type SetupState = { error?: string; organizations?: Array<{ id: string; name: string }>; email?: string };

type LoginResponse =
  ({ status: "authenticated" } & SessionTokens) | { status: "mfa_required"; challengeToken: string } | ({ status?: undefined } & Partial<SessionTokens>);

interface FacilityRow {
  id: string;
  name: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { ...forwardedHeaders(await requestHeaders()), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

/**
 * Signs the kiosk's own staff account in, once per device. The account holds only the Patient kiosk role, so a stolen
 * screen can open nothing but the kiosk's few calls. The facility is the account's only one; a kiosk is bound to one.
 */
export async function signInDevice(_: SetupState, form: FormData): Promise<SetupState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const organizationId = String(form.get("organizationId") ?? "") || undefined;
  if (!email || !password) return { error: "Enter the kiosk account's email and password.", email };

  let tokens: SessionTokens;
  try {
    const result = await post<LoginResponse>("/auth/login", { email, password, organizationId });
    if (result.status === "mfa_required") {
      return { error: "This account asks for a two-step code. A kiosk account must be exempted from that by an administrator.", email };
    }
    if (!result.accessToken || !result.refreshToken) return { error: "Sign-in did not complete.", email };
    tokens = result as SessionTokens;
  } catch (error) {
    const e = error as { code?: string; message?: string; details?: { organizations?: Array<{ id: string; name: string }> } };
    if (e.code === "organization_selection_required" && e.details?.organizations?.length) return { organizations: e.details.organizations, email };
    return { error: e.message ?? "Sign-in failed.", email };
  }

  const jar = await cookies();
  clearSessionCookies(jar);
  writeTokenCookies(jar, tokens);
  try {
    const response = await fetch(`${API_BASE_URL}/auth/me/facilities`, {
      headers: { ...forwardedHeaders(await requestHeaders()), authorization: `Bearer ${tokens.accessToken}`, accept: "application/json" },
      cache: "no-store",
    });
    const facilities = response.ok ? ((await response.json()) as FacilityRow[]) : [];
    const [only] = facilities;
    if (facilities.length !== 1 || !only) {
      clearSessionCookies(jar);
      return { error: "A kiosk account must have a role at exactly one facility.", email };
    }
    jar.set(COOKIES.facility, only.id, { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/" });
  } catch {
    clearSessionCookies(jar);
    return { error: "The server could not be reached. Try again.", email };
  }
  redirect("/");
}
