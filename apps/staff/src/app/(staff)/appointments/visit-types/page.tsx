import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { VisitType } from "@/lib/api/types";
import { VisitTypeList } from "./visit-type-list";

export const metadata = { title: "Visit types" };

export default async function VisitTypesPage() {
  const session = await getSession();
  if (!can(session, "appointment.read")) redirect("/");
  const visitTypes = await api<VisitType[]>("/clinic/visit-types");
  return (
    <>
      <PageHeader
        title="Visit types"
        description="Choose which visits patients may book themselves in MyHealth. Patients book only inside published schedules, at least 2 hours ahead and up to 60 days out, with at most 3 open bookings; they can change or cancel until 2 hours before."
      />
      <VisitTypeList visitTypes={visitTypes} canConfigure={can(session, "clinic.configure")} />
    </>
  );
}
