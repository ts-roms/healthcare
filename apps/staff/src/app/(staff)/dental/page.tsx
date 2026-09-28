import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { clinicalDate, clinicalTime, sexLabel } from "@healthcare/ui/healthcare";
import { Badge, Button, Card } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { DentalVisits } from "@/lib/api/types";

export const metadata = { title: "Dental" };

/** Today's dental patients at the selected facility: dentists' encounters, whether each has been charted and treated. */
export default async function DentalPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const [session, facility, { date }] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "dental.record.read")) redirect("/");
  const actions = can(session, "patient.search") ? (
    <Button asChild size="sm" variant="outline">
      <Link href="/patients">
        <SearchIcon /> Find a patient
      </Link>
    </Button>
  ) : null;
  if (!facility) {
    return (
      <>
        <PageHeader title="Dental" actions={actions} />
        <FacilityRequired action="Dental visits are listed per facility." />
      </>
    );
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : undefined;
  const { date: shown, visits } = await api<DentalVisits>("/dental/visits", { query: { date: day } });
  return (
    <>
      <PageHeader title="Dental" description={`${facility.name} · ${day ? clinicalDate(shown) : "today"} · dentists' consultations`} actions={actions} />
      <div className="p-4">
        <Card className="max-w-5xl">
          {visits.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">
              No dental consultations yet. Start one from the queue (Consultations) or from a patient&apos;s dental record.
            </p>
          ) : null}
          <ul className="divide-y" aria-label="Dental consultations">
            {visits.map((v) => (
              <li key={v.encounterId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="tabular w-14 text-table text-muted-foreground">{clinicalTime(v.startedAt)}</span>
                <span className="min-w-0 flex-1">
                  <Link href={`/dental/patients/${v.patientId}`} className="font-medium text-primary hover:underline">
                    {v.patient?.displayName ?? "Patient"}
                  </Link>
                  <span className="text-table text-muted-foreground">
                    {v.patient ? ` · ${v.patient.patientNumber} · ${v.patient.age} y · ${sexLabel(v.patient.sex)}` : ""}
                    {v.chiefComplaint ? ` · ${v.chiefComplaint}` : ""}
                  </span>
                  <span className="block text-meta text-muted-foreground">{v.practitionerName}</span>
                </span>
                <span className="text-meta text-muted-foreground">
                  {v.examinations ? `Charted${v.examinations > 1 ? ` ×${v.examinations}` : ""}` : "Not charted"} · {v.procedures} procedure
                  {v.procedures === 1 ? "" : "s"}
                </span>
                <Badge variant={v.status === "in_progress" ? "teal" : "success"}>{v.status === "in_progress" ? "In progress" : "Signed"}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
