import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { ProcedureDefinition } from "@/lib/api/types";
import { ProcedureCatalog } from "./procedure-catalog";

export const metadata = { title: "Procedures" };

/**
 * The organization's own procedure catalogue (clinic.configure to change; clinical staff read it). No national
 * procedure code set, relative value scale or PhilHealth code is built in: the organization names its own codes and,
 * if it uses one, the code system of another code.
 */
export default async function ProceduresPage() {
  const session = await getSession();
  if (!can(session, "encounter.read")) redirect("/");
  const definitions = await api<ProcedureDefinition[]>("/clinic/procedure-definitions", { query: { includeInactive: "true" } });
  return (
    <>
      <PageHeader
        title="Procedures"
        description="The procedures your clinic performs in consultations (not dental work or vaccinations), with your own codes. Billing charges a procedure when a service is mapped to its code (Billing → Settings)."
      />
      <ProcedureCatalog definitions={definitions} canConfigure={can(session, "clinic.configure")} />
    </>
  );
}
