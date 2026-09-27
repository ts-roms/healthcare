import { getPatientChart } from "@/lib/demo-data";
import { Patient360 } from "./patient-360";

export const metadata = { title: "Patient 360 preview" };

/** Design preview of the full Patient 360 on a sample patient (clinical modules are not connected yet). */
export default async function Patient360PreviewPage() {
  const chart = (await getPatientChart("p-10293"))!;
  return <Patient360 chart={chart} />;
}
