import "server-only";
import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { forwardedHeaders, toApiError } from "@healthcare/web-session";
import { API_BASE_URL, COOKIES } from "./config";

export interface ApiRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Makes a retried POST safe (the API de-duplicates by key). */
  idempotencyKey?: string;
  /** Send the person's kiosk session token (`X-Kiosk-Session`). */
  withSession?: boolean;
}

/**
 * Calls the API as this kiosk's device account, from server components and server actions. The access token and the
 * person's session token are read from httpOnly cookies here and never reach the browser's scripts. A 401 means the
 * device is signed out (or was disabled): the screen goes to the set-up page. Other errors throw `ApiError`.
 */
export async function kioskApi<T>(path: string, { method = "GET", body, idempotencyKey, withSession = false }: ApiRequest = {}): Promise<T> {
  const jar = await cookies();
  const accessToken = jar.get(COOKIES.access)?.value;
  if (!accessToken) redirect("/setup");
  const headers: Record<string, string> = {
    ...forwardedHeaders(await requestHeaders()),
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
  };
  const facilityId = jar.get(COOKIES.facility)?.value;
  if (facilityId) headers["x-facility-id"] = facilityId;
  const session = jar.get(COOKIES.session)?.value;
  if (withSession && session) headers["x-kiosk-session"] = session;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  const response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  if (response.status === 401) redirect("/setup?reason=session");
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
