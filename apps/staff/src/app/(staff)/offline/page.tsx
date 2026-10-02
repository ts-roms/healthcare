import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { getPractitioners, getVisitTypes } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { QueueVisit } from "@/lib/api/types";
import { OfflineWorkspace } from "./offline-workspace";

export const metadata = { title: "Offline" };

/**
 * The offline workspace (ADR-0013). Rendered with a snapshot of today's queue, the visit types and the practitioners
 * whenever it loads with a connection; the service worker keeps that copy and serves it when the connection is gone,
 * so what this page shows offline is "as of" its last online load. Captured actions are replayed through the same
 * server actions as the live screens.
 */
export default async function OfflinePage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  const permissions = {
    register: can(session, "patient.register"),
    walkIn: can(session, "clinic.queue.manage") && facility !== null,
    triage: can(session, "clinic.triage.write") && facility !== null,
  };
  const [visits, visitTypes, practitioners] = await Promise.all([
    facility ? api<QueueVisit[]>("/queue").catch(() => []) : Promise.resolve([]),
    permissions.walkIn ? getVisitTypes().catch(() => []) : Promise.resolve([]),
    permissions.walkIn ? getPractitioners().catch(() => []) : Promise.resolve([]),
  ]);
  const snapshot = {
    takenAt: new Date().toISOString(),
    facilityName: facility?.name ?? null,
    visits: visits
      .filter((v) => ["waiting", "in_triage"].includes(v.status))
      .map((v) => ({
        id: v.id,
        ticket: v.ticket,
        patientNumber: v.patient?.patientNumber ?? "",
        displayName: v.patient?.displayName ?? "Patient",
        chiefComplaint: v.chiefComplaint ?? "",
        priority: v.priority,
      })),
    visitTypes: visitTypes.filter((v) => v.modality === "in_person").map((v) => ({ id: v.id, name: v.name })),
    practitioners: practitioners.map((p) => ({ id: p.id, name: p.displayName })),
  };
  return (
    <>
      <PageHeader
        title="Offline"
        description="When the connection is down: capture registrations, walk-in check-ins and vital signs here; they are sent, in order, as soon as the connection returns, and anything the system refuses waits for you to resolve."
      />
      <OfflineWorkspace snapshot={snapshot} permissions={permissions} />
    </>
  );
}
