import { redirect } from "next/navigation";
import { can, getSession } from "@/lib/api/session";

/** Records: patients' records requests, FHIR imports from other systems, and document retention. */
export default async function RecordsPage() {
  const session = await getSession();
  if (can(session, "patient.records-request.manage")) redirect("/records/requests");
  redirect(can(session, "interop.fhir.import.review") ? "/records/imports" : "/records/retention");
}
