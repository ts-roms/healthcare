"use server";

import { headers as requestHeaders } from "next/headers";
import { forwardedHeaders, toApiError, userMessage } from "@healthcare/web-session";
import { API_BASE_URL } from "@/lib/api/config";
import { normalizeSecondFactor, SECOND_FACTOR_HINT } from "@/lib/second-factor";

// Signed-out password reset (docs/security/access-control.md, "Password reset by email"). The API answers asking the same
// way whether or not the account exists, checks the link, and asks for a code when two-step verification is on.

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { ...forwardedHeaders(await requestHeaders()), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw await toApiError(response);
}

export async function askForResetLink(email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { ok: false, message: "Enter the email you sign in with." };
  try {
    await post("/auth/password-reset/request", { email: address });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: userMessage(error) };
  }
}

export async function chooseNewPassword(input: {
  token: string;
  password: string;
  confirm: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; message: string; codeRequired?: boolean }> {
  if (input.password.length < 12) return { ok: false, message: "The new password needs at least 12 characters." };
  if (input.password !== input.confirm) return { ok: false, message: "The passwords do not match." };
  const typed = input.code.trim();
  const code = typed ? normalizeSecondFactor(typed) : "";
  if (code === null) return { ok: false, message: SECOND_FACTOR_HINT };
  try {
    await post("/auth/password-reset", { token: input.token, password: input.password, ...(code ? { code } : {}) });
    return { ok: true };
  } catch (error) {
    const e = error as { code?: string };
    return { ok: false, message: userMessage(error), codeRequired: e.code === "mfa_code_required" };
  }
}
