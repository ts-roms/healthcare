import { notFound } from "next/navigation";
import { getPatientChart } from "@/lib/data";
import { Patient360 } from "./patient-360";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chart = await getPatientChart(id);
  if (!chart) notFound();
  return <Patient360 chart={chart} />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const chart = await getPatientChart((await params).id);
  return { title: chart ? `${chart.patient.givenName} ${chart.patient.familyName}` : "Patient" };
}
