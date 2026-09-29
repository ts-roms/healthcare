import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { QueueVisit } from "@/lib/api/types";
import { canStartConsultation, visitStatusLabel } from "@/lib/clinic-mapping";
import { StartConsultationButton } from "./start-consultation-button";

export const metadata = { title: "Consultations" };

/** Today's consultations at the selected facility: who is ready, who is being seen, who has been seen. */
export default async function EncountersPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "encounter.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Consultations" />
        <FacilityRequired action="Consultations are listed per facility." />
      </>
    );
  }
  if (!can(session, "clinic.queue.read")) {
    return (
      <>
        <PageHeader title="Consultations" />
        <p className="m-4 text-body text-muted-foreground">Open a consultation from the patient record.</p>
      </>
    );
  }
  const visits = await api<QueueVisit[]>("/queue", { query: { includeClosed: "true" } });
  const shown = visits.filter((v) => v.status === "awaiting_consultation" || v.status === "in_consultation" || v.encounterId);
  const canStart = can(session, "encounter.write");
  return (
    <>
      <PageHeader title="Consultations" description={`${facility.name} · today`} />
      <div className="p-4">
        <Card className="max-w-4xl">
          {shown.length === 0 ? <p className="p-4 text-body text-muted-foreground">No patients are ready for a consultation yet.</p> : null}
          <ul className="divide-y">
            {shown.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-14 font-mono font-bold">{v.ticket}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{v.patient?.displayName ?? "Patient"}</span>
                  <span className="text-table text-muted-foreground">
                    {" "}
                    · arrived {clinicalTime(v.checkedInAt)}
                    {v.chiefComplaint ? ` · ${v.chiefComplaint}` : ""}
                  </span>
                </span>
                {v.priority !== "routine" ? (
                  <Badge variant={v.priority === "emergency" ? "critical" : "danger"}>{v.priority === "emergency" ? "Emergency" : "Urgent"}</Badge>
                ) : null}
                <Badge variant={v.status === "in_consultation" ? "teal" : v.status === "completed" ? "success" : "info"}>{visitStatusLabel(v.status)}</Badge>
                {v.encounterId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/clinic/encounters/${v.encounterId}`}>Open</Link>
                  </Button>
                ) : canStart && canStartConsultation(v.status) ? (
                  <StartConsultationButton visit={v} />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
