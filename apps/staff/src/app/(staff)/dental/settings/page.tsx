import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { DentalPortalSetting, DentalSettings } from "@/lib/api/types";
import { DentalSettingsForm } from "./dental-settings";

export const metadata = { title: "Dental settings" };

/** The organization's dental procedure catalog, the selected facility's tooth notation, and MyHealth dental records. */
export default async function DentalSettingsPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "dental.record.read")) redirect("/");
  const [settings, portal] = await Promise.all([api<DentalSettings>("/dental/settings"), api<DentalPortalSetting>("/dental/settings/portal")]);
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
    </>
  );
}
