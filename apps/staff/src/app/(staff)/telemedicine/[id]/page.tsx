import { getPatientChart } from "@/lib/demo-data";
import { Consultation } from "./consultation";

export const metadata = { title: "Online consultation" };

export default async function ConsultationPage() {
  const chart = (await getPatientChart("p-10293"))!;
  return <Consultation chart={chart} />;
}
