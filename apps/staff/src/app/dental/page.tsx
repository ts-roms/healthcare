import { getPatientChart } from "@/lib/data";
import { DentalChartView } from "./dental-chart";

export const metadata = { title: "Dental" };

export default async function DentalPage() {
  const chart = (await getPatientChart("p-10293"))!;
  return <DentalChartView patient={chart.patient} initialChart={chart.dental} />;
}
