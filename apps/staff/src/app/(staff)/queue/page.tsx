import Link from "next/link";
import { redirect } from "next/navigation";
import { MonitorIcon, SearchIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { getServicePoints } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { QueueVisit, ServicePointSettings } from "@/lib/api/types";
import { QueueWorkspace } from "./queue-workspace";
import { ServicePointSwitcher } from "./service-point-switcher";

export const metadata = { title: "Queue" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ servicePoint?: string }> }) {
  const [session, facility, params] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "clinic.queue.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Queue" />
        <FacilityRequired action="The queue belongs to a facility." />
      </>
    );
  }
  // One service point of the facility (migration 0113), or the whole queue; an unknown id falls back to the whole queue.
  const servicePoints = await getServicePoints(facility.id);
  const selectedServicePoint = params.servicePoint && UUID.test(params.servicePoint) ? servicePoints.find((s) => s.id === params.servicePoint) : undefined;
  // Closed visits too, so the board shows who has already been seen today.
  const visits = await api<QueueVisit[]>("/queue", {
    query: { includeClosed: "true", ...(selectedServicePoint ? { servicePointId: selectedServicePoint.id } : {}) },
  });
  const canManage = can(session, "clinic.queue.manage");
  // Whether a route sending a patient on calls them (migration 0115): the panel says so before the click.
  const routing = servicePoints.length > 0 ? await api<ServicePointSettings>("/clinic/service-point-settings", { query: { facilityId: facility.id } }) : null;
  return (
    <>
      <PageHeader
        title="Queue"
        description={`${facility.name} · ${selectedServicePoint ? selectedServicePoint.name : "all service points"} · today · refreshes automatically`}
        actions={
          <>
            {can(session, "clinic.queue.display") ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/display/queue" target="_blank" rel="noopener">
                  <MonitorIcon /> Open waiting-room display
                </Link>
              </Button>
            ) : null}
            {canManage && can(session, "patient.search") ? (
              <Button asChild size="sm">
                <Link href="/patients">
                  <SearchIcon /> Find patient to check in
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {servicePoints.length > 0 ? <ServicePointSwitcher servicePoints={servicePoints} selectedId={selectedServicePoint?.id ?? ""} /> : null}
      <QueueWorkspace
        visits={visits}
        servicePoints={servicePoints}
        autoCall={routing?.autoCallOnRoute ?? false}
        canManage={canManage}
        canTriage={can(session, "clinic.triage.write")}
        canOpenRecord={can(session, "patient.read")}
        canConsult={can(session, "encounter.write")}
        canOpenEncounter={can(session, "encounter.read")}
        canRecordProcedure={can(session, "procedure.record")}
      />
    </>
  );
}
