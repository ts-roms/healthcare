import { redirect } from "next/navigation";
import { SettingsPage } from "@healthcare/ui/layouts";
import { AddSheet, Card, Explain, Tabs, TabsContent, TabsList, TabsTrigger } from "@healthcare/ui/primitives";
import { NextLink } from "@/components/next-link";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { ConsentSigningSetting, ProcedureDefinition, ProcedureSupplyOptions } from "@/lib/api/types";
import { ConsentSigningSettings } from "./consent-signing-settings";
import { ProcedureCatalog } from "./procedure-catalog";
import { ProcedureConsentWording } from "./procedure-consent-wording";
import { ProcedureForm } from "./procedure-form";
import { ProcedureSupplyTemplates } from "./procedure-supply-templates";

export const metadata = { title: "Procedures" };

/** A small count after a tab's name. */
function Count({ n }: { n: number }) {
  return <span className="tabular rounded-full bg-muted px-1.5 text-meta font-semibold text-muted-foreground">{n}</span>;
}

/**
 * The organization's own procedure catalogue (clinic.configure to change; clinical staff read it). No national
 * procedure code set, relative value scale or PhilHealth code is built in: the organization names its own codes and,
 * if it uses one, the code system of another code.
 */
export default async function ProceduresPage() {
  const session = await getSession();
  if (!can(session, "encounter.read")) redirect("/");
  const canConfigure = can(session, "clinic.configure");
  const [definitions, supplyOptions, signingSetting] = await Promise.all([
    api<ProcedureDefinition[]>("/clinic/procedure-definitions", { query: { includeInactive: "true" } }),
    api<ProcedureSupplyOptions>("/clinic/procedure-supplies/options"),
    api<ConsentSigningSetting>("/clinic/consent-signing/settings"),
  ]);
  return (
    <SettingsPage
      title="Procedures"
      description="The procedures your clinic performs, with your own codes, consent wording and note templates."
      Link={NextLink}
      breadcrumbs={[{ label: "Settings", href: "/admin" }, { label: "Clinical" }]}
      actions={
        canConfigure ? (
          <AddSheet label="Add procedure" description="Its own code is kept as written and never changes.">
            <ProcedureForm />
          </AddSheet>
        ) : undefined
      }
      explain={
        <Explain summary="How procedures work">
          <p>
            This catalogue is for procedures done at the clinic, not dental work or vaccinations. Billing charges a procedure when a service is mapped to its
            code (Billing → Settings).
          </p>
          <p>Codes are your organization&apos;s own; no national code set is built in.</p>
        </Explain>
      }
    >
      <Tabs defaultValue="catalog">
        <TabsList aria-label="Procedure settings">
          <TabsTrigger value="catalog">
            Catalog <Count n={definitions.length} />
          </TabsTrigger>
          <TabsTrigger value="consent">
            Consent wording <Count n={definitions.filter((d) => d.consentWording).length} />
          </TabsTrigger>
          <TabsTrigger value="signing">Signing</TabsTrigger>
          <TabsTrigger value="supplies">
            Supply templates <Count n={supplyOptions.templates.length} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="catalog">
          <Card>
            <ProcedureCatalog definitions={definitions} canConfigure={canConfigure} />
          </Card>
        </TabsContent>
        <TabsContent value="consent">
          <Card>
            <ProcedureConsentWording definitions={definitions.filter((d) => d.status === "active")} canConfigure={canConfigure} />
          </Card>
        </TabsContent>
        <TabsContent value="signing">
          <Card>
            <ConsentSigningSettings setting={signingSetting} canConfigure={canConfigure} />
          </Card>
        </TabsContent>
        <TabsContent value="supplies">
          <Card>
            <ProcedureSupplyTemplates options={supplyOptions} definitions={definitions} canConfigure={canConfigure} />
          </Card>
        </TabsContent>
      </Tabs>
    </SettingsPage>
  );
}
