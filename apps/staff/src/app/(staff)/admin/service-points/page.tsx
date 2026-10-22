import { StaffSettingsPage, SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { RouteTemplate, ServicePoint, ServicePointSettings, VisitType } from "@/lib/api/types";
import { RouteTemplates } from "./route-templates";
import { RoutingSettings } from "./routing-settings";
import { ServicePointList } from "./service-point-list";

export const metadata = { title: "Service points" };

/**
 * The selected facility's service points (migration 0113): where a triaged patient can be sent — the consultation
 * line, the emergency room, X-ray, other stations — as the organization names them. Nothing national is assumed.
 */
export default async function ServicePointsPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "clinic.configure")) redirect("/");
  if (!facility) {
    return (
      <StaffSettingsPage group="Organization" title="Service points">
        <FacilityRequired action="Service points belong to a facility." />
      </StaffSettingsPage>
    );
  }
  const [servicePoints, settings, templates, visitTypes] = await Promise.all([
    api<ServicePoint[]>("/clinic/service-points", { query: { facilityId: facility.id, includeInactive: "true" } }),
    api<ServicePointSettings>("/clinic/service-point-settings", { query: { facilityId: facility.id } }),
    api<RouteTemplate[]>("/clinic/route-templates", { query: { facilityId: facility.id, includeInactive: "true" } }),
    api<VisitType[]>("/clinic/visit-types").then((all) => all.filter((v) => v.status === "active" && v.modality === "in_person")),
  ]);
  return (
    <StaffSettingsPage
      group="Organization"
      title="Service points"
      description={`${facility.name} · where a patient can be sent after triage.`}
      details={[
        "Without any service point, the facility keeps its single consultation line.",
        "A deactivated service point keeps the visits already sent to it and only refuses new ones.",
      ]}
    >
      <SettingsStack>
        <ServicePointList facilityId={facility.id} servicePoints={servicePoints} />
        <RoutingSettings key={settings.version ?? 0} settings={settings} />
        <RouteTemplates facilityId={facility.id} templates={templates} servicePoints={servicePoints} visitTypes={visitTypes} />
      </SettingsStack>
    </StaffSettingsPage>
  );
}
