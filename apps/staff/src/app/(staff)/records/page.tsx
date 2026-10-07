import { redirect } from "next/navigation";
import { can, getSession } from "@/lib/api/session";

/** Records: patients' records requests, FHIR imports from other systems, document retention and the integrity review. */
export default async function RecordsPage() {
  const session = await getSession();
  if (can(session, "patient.records-request.manage")) redirect("/records/requests");
  if (can(session, "interop.fhir.import.review")) redirect("/records/imports");
  redirect(can(session, "document.retention.manage") ? "/records/retention" : "/records/integrity");
}
