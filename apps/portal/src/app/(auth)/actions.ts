"use server";

import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { forwardedHeaders, safeNextPath, toApiError } from "@healthcare/web-session";
import { API_BASE_URL, PORTAL_ORGANIZATION_CODE } from "@/lib/api/config";
import { writeTokenCookies } from "@/lib/api/tokens";
import type { PortalTokenResponse } from "@/lib/api/types";
import { activateFormSchema, type FieldErrors, loginFormSchema, parseForm, patientMessage } from "@/lib/forms";

export interface AuthFormState {
  error?: string;
  fieldErrors?: FieldErrors;
  /** Non-secret values to put back in the form after an error. */
  values?: Record<string, string>;
}

const AUTH_PATHS = ["/login", "/activate"];

async function post(path: string, body: unknown): Promise<PortalTokenResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { ...forwardedHeaders(await requestHeaders()), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as PortalTokenResponse;
}

export async function signIn(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const values = { email: String(form.get("email") ?? "") };
  const parsed = parseForm(loginFormSchema, form, ["email", "password"]);
  if (!parsed.ok) return { fieldErrors: parsed.errors, values };

  let tokens: PortalTokenResponse;
  try {
    tokens = await post("/portal/auth/login", { organizationCode: PORTAL_ORGANIZATION_CODE, ...parsed.data });
  } catch (error) {
    return { error: patientMessage(error), values };
  }
  writeTokenCookies(await cookies(), tokens);
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
