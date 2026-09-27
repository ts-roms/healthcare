import "server-only";
import { cache } from "react";
import { api } from "./client";
import type { Facility, Me } from "./types";

/** The signed-in user, organization and effective permissions (one API call per request). */
export const getSession = cache(() => api<Me>("/auth/me"));

/** Facilities of the organization, or none when the user may not read them. */
export const getFacilities = cache(async (): Promise<Facility[]> => {
  const session = await getSession();
  if (!session.permissions.includes("organization.read")) return [];
  const facilities = await api<Facility[]>("/facilities");
  return facilities.filter((f) => f.status === "active");
});

export function can(session: Pick<Me, "permissions">, permission: string): boolean {
  return session.permissions.includes(permission);
}
