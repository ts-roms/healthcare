import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { ServicePoint, ServicePointSettings } from "@/lib/api/types";
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
      <>
        <PageHeader title="Service points" />
        <FacilityRequired action="Service points belong to a facility." />
      </>
    );
  }
  const [servicePoints, settings] = await Promise.all([
    api<ServicePoint[]>("/clinic/service-points", { query: { facilityId: facility.id, includeInactive: "true" } }),
    api<ServicePointSettings>("/clinic/service-point-settings", { query: { facilityId: facility.id } }),
  ]);
  return (
    <>
      <PageHeader
        title="Service points"
        description={`${facility.name} · where a patient can be sent after triage. Without any, the facility keeps its single consultation line. A deactivated service point keeps the visits already sent to it and only refuses new ones.`}
      />
      <ServicePointList facilityId={facility.id} servicePoints={servicePoints} />
      <RoutingSettings key={settings.version ?? 0} settings={settings} />
    </>
  );
}
