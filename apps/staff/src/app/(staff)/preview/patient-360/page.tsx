import Link from "next/link";
import { getPatientChart } from "@/lib/demo-data";
import { Patient360 } from "./patient-360";

export const metadata = { title: "Patient 360 preview" };

/**
 * Design preview of the full Patient 360 on a sample patient (demo fixtures only). The real, API-backed workspace is
 * /patients/[id]/360, opened from the patient record, search results, the queue and the encounter workspace.
 */
export default async function Patient360PreviewPage() {
  const chart = (await getPatientChart("p-10293"))!;
  return (
    <>
      <p className="border-b bg-card px-4 py-2 text-table text-muted-foreground">
        Sample patient, design preview only. For a real patient, open <strong className="font-medium text-foreground">Patient 360</strong> from the patient
        record:{" "}
        <Link href="/patients" className="text-primary hover:underline">
          find a patient
        </Link>
        .
      </p>
      <Patient360 chart={chart} />
    </>
  );
}
