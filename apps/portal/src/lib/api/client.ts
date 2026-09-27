import "server-only";
import { cookies, headers as requestHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { forwardedHeaders, toApiError } from "@healthcare/web-session";
import { API_BASE_URL, COOKIES } from "./config";

/**
 * Calls the API as the signed-in patient from server components and server
 * actions. A 401 means the portal session ended (signed out, expired, or
 * portal access withdrawn): the patient is sent to sign in again. Other
 * errors throw `ApiError`.
 */
export async function portalApi<T>(path: string, { method = "GET", body }: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const accessToken = (await cookies()).get(COOKIES.access)?.value;
  if (!accessToken) redirect("/login");
  const headers: Record<string, string> = {
    ...forwardedHeaders(await requestHeaders()),
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${API_BASE_URL}${path}`, {
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
