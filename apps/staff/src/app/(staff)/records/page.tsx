import { redirect } from "next/navigation";

/** Records has one screen so far: FHIR imports. */
export default function RecordsPage() {
  redirect("/records/imports");
}
