import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClipboardListIcon, UserIcon } from "lucide-react";
import { clinicalTime, sexLabel } from "@healthcare/ui/healthcare";
import { Badge, Button } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { DentalRecord, DentalRecordSupplies, DentalSettings, DentalSupplyOptions, DentalVisits } from "@/lib/api/types";
import { todayIn } from "@/lib/clinic-mapping";
import { openVisit } from "@/lib/dental-mapping";
import { DentalChartPanel } from "./dental-chart-panel";
import { DentalImages } from "./dental-images";
import { Examinations } from "./examinations";
import { Periodontal } from "./periodontal";
import { Procedures } from "./procedures";
import { StartVisit } from "./start-visit";
import { TreatmentPlans } from "./treatment-plans";

export const metadata = { title: "Dental record" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A patient's dental record: the odontogram and its history, examinations, treatment plans, procedures and imaging.
 * Charting and procedures are recorded into the patient's dental visit in progress at the selected facility.
 */
export default async function DentalRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "dental.record.read")) redirect("/");
  let record: DentalRecord & DentalRecordSupplies;
  try {
    record = await api<DentalRecord & DentalRecordSupplies>(`/dental/patients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const canRecordProcedure = can(session, "dental.procedure.record");
  const [settings, visits, supplyOptions] = await Promise.all([
    api<DentalSettings>("/dental/settings"),
    facility ? api<DentalVisits>("/dental/visits").then((v) => v.visits) : Promise.resolve([]),
    facility && canRecordProcedure ? api<DentalSupplyOptions>("/dental/supplies/options") : Promise.resolve(null),
  ]);
  const visit = openVisit(visits, id);
  const encounterId = visit?.encounterId ?? null;
  const types = settings.procedureTypes.filter((t) => t.status === "active");
  const canCorrect = can(session, "dental.record.write");
  const p = record.patient;

  return (
    <>
      <PageHeader
        title={`Dental · ${p.displayName}`}
        description={`${p.patientNumber} · ${p.age} y · ${sexLabel(p.sex)}${facility ? ` · ${facility.name}` : ""}`}
        actions={
          <>
            {visit ? (
              <Badge variant="teal">Dental visit in progress since {clinicalTime(visit.startedAt)}</Badge>
            ) : facility && can(session, "encounter.write") && can(session, "dental.chart.write") ? (
              <StartVisit patientId={id} />
            ) : null}
            {visit && can(session, "encounter.read") ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/clinic/encounters/${visit.encounterId}`}>
                  <ClipboardListIcon /> Notes &amp; prescriptions
                </Link>
              </Button>
            ) : null}
            {can(session, "patient.read") ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/patients/${id}`}>
                  <UserIcon /> Patient record
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        {!facility ? <p className="text-meta text-muted-foreground">Select your facility to record examinations and procedures.</p> : null}
        <DentalChartPanel
          patientId={id}
          patientAge={p.age}
          teeth={record.chart}
          notation={record.notation}
          encounterId={encounterId}
          canChart={can(session, "dental.chart.write")}
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <TreatmentPlans
            patientId={id}
            plans={record.plans}
            types={types}
            notation={record.notation}
            canManage={can(session, "dental.treatment-plan.manage")}
          />
          <Procedures
            patientId={id}
            procedures={record.procedures}
            types={types}
            plans={record.plans}
            notation={record.notation}
            encounterId={encounterId}
            canRecord={canRecordProcedure}
            canCorrect={canCorrect}
            supplyUses={record.supplyUses ?? []}
            supplyOptions={supplyOptions}
          />
          <Examinations patientId={id} examinations={record.examinations} notation={record.notation} canCorrect={canCorrect} />
          <Periodontal
            patientId={id}
            charts={record.perioCharts ?? []}
            chart={record.chart}
            notation={record.notation}
            encounterId={encounterId}
            canChart={can(session, "dental.chart.write")}
            canCorrect={canCorrect}
          />
          <DentalImages
            patientId={id}
            images={record.images}
            notation={record.notation}
            encounterId={encounterId}
            today={todayIn(facility?.timezone ?? "Asia/Manila")}
            canRead={can(session, "dental.imaging.read")}
            canUpload={can(session, "dental.imaging.upload") && can(session, "document.upload") && Boolean(facility)}
            canCorrect={canCorrect}
          />
        </div>
      </div>
    </>
  );
}
