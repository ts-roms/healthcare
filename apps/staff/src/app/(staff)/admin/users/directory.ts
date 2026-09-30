import "server-only";
import { api } from "@/lib/api/client";
import { can } from "@/lib/api/session";
import type { Department, FacilityDetail, Me } from "@/lib/api/types";

export interface OrganizationDirectory {
  facilities: FacilityDetail[];
  departments: Department[];
}

/** The organization's facilities and their departments, for naming a role's scope. Empty without organization.read. */
export async function organizationDirectory(session: Me): Promise<OrganizationDirectory> {
  if (!can(session, "organization.read")) return { facilities: [], departments: [] };
  const facilities = await api<FacilityDetail[]>("/facilities");
  const departments = (await Promise.all(facilities.map((f) => api<Department[]>(`/facilities/${f.id}/departments`)))).flat();
  return { facilities, departments };
}

/** "Organization-wide", "Main clinic" or "Main clinic · Laboratory". */
export function scopeLabel(directory: OrganizationDirectory, facilityId: string | null, departmentId: string | null): string {
  if (!facilityId) return "Organization-wide";
  const facility = directory.facilities.find((f) => f.id === facilityId)?.name ?? "A facility";
  if (!departmentId) return facility;
  return `${facility} · ${directory.departments.find((d) => d.id === departmentId)?.name ?? "a department"}`;
}
