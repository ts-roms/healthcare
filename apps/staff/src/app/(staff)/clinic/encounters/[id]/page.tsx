import { notFound } from "next/navigation";
import { catalogs, getEncounter, getPatientChart } from "@/lib/demo-data";
import { EncounterWorkspace } from "./encounter-workspace";

export const metadata = { title: "Encounter" };

export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const encounter = await getEncounter((await params).id);
  if (!encounter) notFound();
  const chart = await getPatientChart(encounter.patientId);
  if (!chart) notFound();
  return <EncounterWorkspace encounter={encounter} chart={chart} diagnosisCatalog={catalogs.diagnoses} prescriptionDraft={catalogs.prescriptionDraft} />;
}
