import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { api } from "./client";
import { COOKIES } from "./config";
import type { Facility, Me } from "./types";

/** The signed-in user, organization and effective permissions (one API call per request). */
export const getSession = cache(() => api<Me>("/auth/me"));

/** Facilities of the organization, or none when the user may not read them. */
/** The active facilities the user holds a role in (all of them for an organization-wide role): the facility selector's choices. */
export const getFacilities = cache(async (): Promise<Facility[]> => api<Facility[]>("/auth/me/facilities"));

/** The facility selected in the top bar (sent as X-Facility-Id), if it is one of the organization's active facilities. */
export const getSelectedFacility = cache(async (): Promise<Facility | null> => {
  const [facilities, jar] = await Promise.all([getFacilities(), cookies()]);
  return facilities.find((f) => f.id === jar.get(COOKIES.facility)?.value) ?? null;
});

export function can(session: Pick<Me, "permissions">, permission: string): boolean {
  return session.permissions.includes(permission);
}
