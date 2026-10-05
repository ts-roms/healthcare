import "server-only";
import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { forwardedHeaders, toApiError } from "@healthcare/web-session";
import { ACTING_COOKIE, actingForHeader } from "../proxy-access";
import { API_BASE_URL, COOKIES } from "./config";

/**
 * Calls the API as the signed-in patient from server components and server
 * actions. A 401 means the portal session ended (signed out, expired, or
 * portal access withdrawn): the patient is sent to sign in again. Other
 * errors throw `ApiError`.
 */
export async function portalApi<T>(path: string, { method = "GET", body }: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<T> {
  const jar = await cookies();
  const accessToken = jar.get(COOKIES.access)?.value;
  if (!accessToken) redirect("/login");
  const acting = actingForHeader(path, jar.get(ACTING_COOKIE)?.value);
  const headers: Record<string, string> = {
    ...forwardedHeaders(await requestHeaders()),
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
    ...acting,
  };
  // Only the devices list needs to know which remembered browser this is.
  const deviceToken = path.startsWith("/portal/mfa/devices") ? jar.get(COOKIES.device)?.value : undefined;
  if (deviceToken) headers["x-device-token"] = deviceToken;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 401) redirect("/login?reason=session");
  if (!response.ok) {
    const error = await toApiError(response);
    // The grant ended (or the person's consent changed) while acting: go back to the person's own account.
    if (acting["x-acting-for"] && error.code === "proxy_not_allowed") redirect("/people/stop?ended=1");
    // The clinic requires two-step verification this account has not set up: only Sign-in security (and the profile) open.
    if (response.status === 403 && error.code === "mfa_enrollment_required") redirect("/security?required=1");
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Fetches a file (a PDF) from the API as the signed-in patient, for route handlers that pass it on. */
export async function portalFile(path: string): Promise<Response> {
  const jar = await cookies();
  const accessToken = jar.get(COOKIES.access)?.value;
  if (!accessToken) redirect("/login");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...forwardedHeaders(await requestHeaders()),
      accept: "application/pdf",
      authorization: `Bearer ${accessToken}`,
      ...actingForHeader(path, jar.get(ACTING_COOKIE)?.value),
    },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/login?reason=session");
  return response;
}
