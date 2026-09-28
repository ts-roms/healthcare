import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, request } from "@playwright/test";
import { API_URL, STAFF_PASSWORD } from "./env";

/** A staff user's API session for setting up data (the journeys themselves go through the browser). */
export interface StaffApi {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  dispose(): Promise<void>;
}

async function call<T>(
  context: APIRequestContext,
  method: "GET" | "POST" | "PATCH",
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const response = await context.fetch(`${API_URL}${path}`, { method, headers, data: body });
  const text = await response.text();
  if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function staffApi(email: string, facilityId?: string): Promise<StaffApi> {
  const context = await request.newContext();
  const { accessToken } = await call<{ accessToken: string }>(context, "POST", "/auth/login", {}, { email, password: STAFF_PASSWORD });
  const headers = { authorization: `Bearer ${accessToken}`, ...(facilityId ? { "x-facility-id": facilityId } : {}) };
  return {
    get: (path) => call(context, "GET", path, headers),
    post: (path, body = {}) => call(context, "POST", path, headers, body),
    patch: (path, body = {}) => call(context, "PATCH", path, headers, body),
    dispose: () => context.dispose(),
  };
}

/** Ids created by the setup project for the journeys (tests/setup.setup.ts). */
export interface SeedState {
  facilityId: string;
  practitionerId: string;
  telePractitionerId: string;
  consultVisitTypeId: string;
  onlineVisitTypeId: string;
  /** A patient with an active MyHealth account (journey 2). */
  onlinePatient: { id: string; email: string; displayName: string };
}

const STATE_FILE = join(__dirname, "../.state/seed.json");

export function saveState(state: SeedState): void {
  mkdirSync(join(__dirname, "../.state"), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadState(): SeedState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as SeedState;
}

/** A local date (YYYY-MM-DD) in Manila, `days` from today. */
export function manilaDate(days = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + days * 86_400_000));
}
