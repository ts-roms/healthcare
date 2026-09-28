import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { DentalPortalSetting, DentalSettings, DentalSupplyOptions } from "@/lib/api/types";
import { DentalSettingsForm } from "./dental-settings";
import { SupplySettings } from "./supply-settings";

export const metadata = { title: "Dental settings" };

/** The organization's dental procedure catalog, supply templates, MyHealth dental records, and the selected facility's tooth notation and supply location. */
export default async function DentalSettingsPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "dental.record.read")) redirect("/");
  const [settings, portal, supplies] = await Promise.all([
    api<DentalSettings>("/dental/settings"),
    api<DentalPortalSetting>("/dental/settings/portal"),
    api<DentalSupplyOptions>("/dental/supplies/options"),
  ]);
  return (
    <>
      <PageHeader
        title="Dental settings"
        description="Procedures the clinic records (its own codes; billing prices them by code) and how teeth are numbered on screen."
      />
      <DentalSettingsForm
        settings={settings}
        portal={portal}
        facility={facility ? { id: facility.id, name: facility.name } : null}
        canManage={can(session, "dental.settings.manage")}
      />
      <SupplySettings
        options={supplies}
        procedureTypes={settings.procedureTypes.filter((t) => t.status === "active")}
        facility={facility ? { id: facility.id, name: facility.name } : null}
        canManage={can(session, "dental.settings.manage")}
      />
    </>
  );
}
