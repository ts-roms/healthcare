import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { ConsentSigningSetting, ProcedureDefinition, ProcedureSupplyOptions } from "@/lib/api/types";
import { ConsentSigningSettings } from "./consent-signing-settings";
import { ProcedureCatalog } from "./procedure-catalog";
import { ProcedureConsentWording } from "./procedure-consent-wording";
import { ProcedureSupplyTemplates } from "./procedure-supply-templates";

export const metadata = { title: "Procedures" };

/**
 * The organization's own procedure catalogue (clinic.configure to change; clinical staff read it). No national
 * procedure code set, relative value scale or PhilHealth code is built in: the organization names its own codes and,
 * if it uses one, the code system of another code.
 */
export default async function ProceduresPage() {
  const session = await getSession();
  if (!can(session, "encounter.read")) redirect("/");
  const [definitions, supplyOptions, signingSetting] = await Promise.all([
    api<ProcedureDefinition[]>("/clinic/procedure-definitions", { query: { includeInactive: "true" } }),
    api<ProcedureSupplyOptions>("/clinic/procedure-supplies/options"),
    api<ConsentSigningSetting>("/clinic/consent-signing/settings"),
  ]);
  return (
    <>
      <PageHeader
        title="Procedures"
        description="The procedures your clinic performs (not dental work or vaccinations), with your own codes, consent wording and note templates. Billing charges a procedure when a service is mapped to its code (Billing → Settings)."
      />
      <ProcedureCatalog definitions={definitions} canConfigure={can(session, "clinic.configure")} />
      <ProcedureConsentWording definitions={definitions.filter((d) => d.status === "active")} canConfigure={can(session, "clinic.configure")} />
      <ConsentSigningSettings setting={signingSetting} canConfigure={can(session, "clinic.configure")} />
      <ProcedureSupplyTemplates options={supplyOptions} definitions={definitions} canConfigure={can(session, "clinic.configure")} />
    </>
  );
}
