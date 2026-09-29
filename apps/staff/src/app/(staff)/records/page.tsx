import { redirect } from "next/navigation";
import { can, getSession } from "@/lib/api/session";

/** Records: patients' records requests, and FHIR imports from other systems. */
export default async function RecordsPage() {
  const session = await getSession();
  redirect(can(session, "patient.records-request.manage") ? "/records/requests" : "/records/imports");
}
