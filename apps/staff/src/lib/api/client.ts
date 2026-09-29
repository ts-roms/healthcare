import "server-only";
import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { API_BASE_URL, COOKIES } from "./config";
import { toApiError } from "@healthcare/web-session";
import { forwardedHeaders } from "@healthcare/web-session";

export interface ApiRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Makes a retried POST safe (the API de-duplicates by key). */
  idempotencyKey?: string;
}

export function buildUrl(path: string, query?: ApiRequest["query"]): string {
  const url = new URL(`${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

/**
 * Calls the API as the signed-in user from server components and server
 * actions. Sends the access token and the selected facility (X-Facility-Id).
 * A 401 means the session ended (revoked, expired, signed out elsewhere):
 * the user is sent to sign in again. Other errors throw `ApiError`.
 */
export async function api<T>(path: string, { method = "GET", query, body, idempotencyKey }: ApiRequest = {}): Promise<T> {
  const jar = await cookies();
  const accessToken = jar.get(COOKIES.access)?.value;
  if (!accessToken) redirect("/login");
  const headers: Record<string, string> = {
    ...forwardedHeaders(await requestHeaders()),
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
  };
  const facilityId = jar.get(COOKIES.facility)?.value;
  if (facilityId) headers["x-facility-id"] = facilityId;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 401) redirect("/login?reason=session");
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Fetches a file (a PDF, or a CSV export) from the API as the signed-in user,
 * for route handlers that pass it on to the browser. The token stays on the server.
 */
export async function apiFile(path: string, { accept = "application/pdf", query }: { accept?: string; query?: ApiRequest["query"] } = {}): Promise<Response> {
  const jar = await cookies();
  const accessToken = jar.get(COOKIES.access)?.value;
  if (!accessToken) redirect("/login");
  const headers: Record<string, string> = { ...forwardedHeaders(await requestHeaders()), accept, authorization: `Bearer ${accessToken}` };
  const facilityId = jar.get(COOKIES.facility)?.value;
  if (facilityId) headers["x-facility-id"] = facilityId;
  const response = await fetch(buildUrl(path, query), { headers, cache: "no-store" });
  if (response.status === 401) redirect("/login?reason=session");
  return response;
}
