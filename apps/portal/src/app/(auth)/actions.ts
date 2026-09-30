"use server";

import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { forwardedHeaders, safeNextPath, toApiError } from "@healthcare/web-session";
import { API_BASE_URL, COOKIES, PORTAL_ORGANIZATION_CODE, SECURE_COOKIES } from "@/lib/api/config";
import { writeTokenCookies } from "@/lib/api/tokens";
import type { PortalMfaRequired, PortalTokenResponse } from "@/lib/api/types";
import { activateFormSchema, type FieldErrors, loginFormSchema, parseForm, patientMessage, resetFormSchema, resetRequestFormSchema } from "@/lib/forms";

export interface AuthFormState {
  error?: string;
  fieldErrors?: FieldErrors;
  /** Non-secret values to put back in the form after an error. */
  values?: Record<string, string>;
  /** The password was right and the second step (a code) is next. */
  step?: "mfa";
  /** A reset link was asked for (the answer is the same whether or not an account exists). */
  requested?: boolean;
}

const AUTH_PATHS = ["/login", "/activate", "/forgot-password", "/reset-password"];

async function send(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { ...forwardedHeaders(await requestHeaders()), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function post<T = PortalTokenResponse>(path: string, body: unknown): Promise<T> {
  return (await (await send(path, body)).json()) as T;
}

/** One entry point for the sign-in form: the hidden `intent` field says whether the password or the code is being sent. */
export async function signIn(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  return form.get("intent") === "mfa" ? verifyCode(form) : verifyPassword(form);
}

async function verifyPassword(form: FormData): Promise<AuthFormState> {
  const values = { email: String(form.get("email") ?? "") };
  const parsed = parseForm(loginFormSchema, form, ["email", "password"]);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };

  let result: PortalTokenResponse | PortalMfaRequired;
  try {
    result = await post<PortalTokenResponse | PortalMfaRequired>("/portal/auth/login", { organizationCode: PORTAL_ORGANIZATION_CODE, ...parsed.data });
  } catch (error) {
    return { error: patientMessage(error), values };
  }
  const jar = await cookies();
  if (result.status === "mfa_required") {
    // The challenge stays on the server side of the browser (httpOnly), like the session itself.
    jar.set(COOKIES.mfaChallenge, result.challengeToken, { httpOnly: true, secure: SECURE_COOKIES, sameSite: "strict", path: "/", maxAge: 300 });
    return { step: "mfa", values };
  }
  writeTokenCookies(jar, result);
  redirect(safeNextPath(form.get("next"), "/", AUTH_PATHS));
}

async function verifyCode(form: FormData): Promise<AuthFormState> {
  const code = String(form.get("code") ?? "").trim();
  const challengeToken = (await cookies()).get(COOKIES.mfaChallenge)?.value;
  if (!challengeToken) return { error: "Your sign-in took too long. Enter your password again." };
  if (code.length < 6) return { step: "mfa", fieldErrors: { code: "Enter the 6-digit code from your authenticator app, or a recovery code." } };
  let tokens: PortalTokenResponse;
  try {
    tokens = await post("/portal/auth/mfa/verify", { challengeToken, code });
  } catch (error) {
    return { step: "mfa", error: patientMessage(error) };
  }
  const jar = await cookies();
  jar.delete(COOKIES.mfaChallenge);
  writeTokenCookies(jar, tokens);
  redirect(safeNextPath(form.get("next"), "/", AUTH_PATHS));
}

const ACTIVATE_FIELDS = ["patientNumber", "birthDate", "activationCode", "email", "password", "confirmPassword"] as const;

/** First sign-in: proves identity with the clinic's one-time code, then sets the email and password. */
export async function activate(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const values = Object.fromEntries(["patientNumber", "birthDate", "activationCode", "email"].map((f) => [f, String(form.get(f) ?? "")]));
  const parsed = parseForm(activateFormSchema, form, ACTIVATE_FIELDS);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };

  const { confirmPassword: _confirm, ...body } = parsed.data;
  let tokens: PortalTokenResponse;
  try {
    tokens = await post("/portal/auth/activate", { organizationCode: PORTAL_ORGANIZATION_CODE, ...body });
  } catch (error) {
    return { error: patientMessage(error), values };
  }
  writeTokenCookies(await cookies(), tokens);
  redirect("/?welcome=1");
}

/** Asks for a password-reset link. The patient is told the same thing whether or not the email belongs to an account. */
export async function requestReset(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const values = { email: String(form.get("email") ?? "") };
  const parsed = parseForm(resetRequestFormSchema, form, ["email"]);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };
  try {
    await send("/portal/auth/password-reset/request", { organizationCode: PORTAL_ORGANIZATION_CODE, ...parsed.data });
  } catch (error) {
    return { error: patientMessage(error), values };
  }
  return { requested: true, values };
}

/** Chooses a new password with the emailed token and the patient's date of birth, then sends them to sign in. */
export async function resetPassword(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const values = { birthDate: String(form.get("birthDate") ?? "") };
  const parsed = parseForm(resetFormSchema, form, ["token", "birthDate", "password", "confirmPassword"]);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };
  const { confirmPassword: _confirm, ...body } = parsed.data;
  try {
    await send("/portal/auth/password-reset/confirm", body);
  } catch (error) {
    return { error: patientMessage(error), values };
  }
  redirect("/login?reason=password_reset");
}
