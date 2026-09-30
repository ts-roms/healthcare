"use server";

import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { API_BASE_URL, COOKIES, SECURE_COOKIES } from "@/lib/api/config";
import { toApiError, userMessage } from "@healthcare/web-session";
import { forwardedHeaders } from "@healthcare/web-session";
import { safeNextPath } from "@healthcare/web-session";
import { writeTokenCookies } from "@/lib/api/tokens";
import type { Facility, LoginResponse, OrganizationChoice, TokenResponse } from "@/lib/api/types";
import { normalizeSecondFactor, SECOND_FACTOR_HINT } from "@/lib/second-factor";

export type LoginState =
  | { step: "password"; error?: string; email?: string }
  | { step: "organization"; email: string; organizations: OrganizationChoice[]; error?: string }
  | { step: "mfa"; error?: string };

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

/** Stores the session and, when the user can work in exactly one facility, selects it. */
async function startSession(tokens: TokenResponse): Promise<void> {
  const jar = await cookies();
  writeTokenCookies(jar, tokens);
  jar.delete(COOKIES.mfaChallenge);
  try {
    const response = await fetch(`${API_BASE_URL}/auth/me/facilities`, {
      headers: { ...forwardedHeaders(await requestHeaders()), authorization: `Bearer ${tokens.accessToken}`, accept: "application/json" },
      cache: "no-store",
    });
    if (response.ok) {
      const active = (await response.json()) as Facility[];
      const [only] = active;
      if (active.length === 1 && only) {
        jar.set(COOKIES.facility, only.id, { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/" });
        jar.set(COOKIES.timeZone, only.timezone, { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/" });
      } else {
        jar.delete(COOKIES.facility);
        jar.delete(COOKIES.timeZone);
      }
    }
  } catch {
    // Facility can be chosen later from the top bar.
  }
}

async function signIn(form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const organizationId = String(form.get("organizationId") ?? "") || undefined;
  const next = safeNextPath(form.get("next"));
  if (!email || !password) return { step: "password", email, error: "Enter your email and password." };

  let result: LoginResponse;
  try {
    result = await post<LoginResponse>("/auth/login", { email, password, organizationId });
  } catch (error) {
    const e = error as { code?: string; details?: { organizations?: OrganizationChoice[] } };
    if (e.code === "organization_selection_required" && e.details?.organizations?.length) {
      return { step: "organization", email, organizations: e.details.organizations };
    }
    return { step: "password", email, error: userMessage(error) };
  }

  if (result.status === "mfa_required") {
    (await cookies()).set(COOKIES.mfaChallenge, result.challengeToken, {
      httpOnly: true,
      secure: SECURE_COOKIES,
      sameSite: "strict",
      path: "/",
      maxAge: 300,
    });
    return { step: "mfa" };
  }
  await startSession(result);
  redirect(next);
}

async function verifyMfa(form: FormData): Promise<LoginState> {
  const code = normalizeSecondFactor(String(form.get("code") ?? ""));
  const next = safeNextPath(form.get("next"));
  const challengeToken = (await cookies()).get(COOKIES.mfaChallenge)?.value;
  if (!challengeToken) return { step: "password", error: "Your sign-in attempt expired. Enter your password again." };
  if (!code) return { step: "mfa", error: SECOND_FACTOR_HINT };

  let tokens: TokenResponse;
  try {
    tokens = await post<TokenResponse>("/auth/mfa/verify", { challengeToken, code });
  } catch (error) {
    return { step: "mfa", error: userMessage(error) };
  }
  await startSession(tokens);
  redirect(next);
}

/** One entry point for the sign-in form: the hidden `intent` field says which step is being submitted. */
export async function authenticate(_prev: LoginState, form: FormData): Promise<LoginState> {
  return form.get("intent") === "mfa" ? verifyMfa(form) : signIn(form);
}
