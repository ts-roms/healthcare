import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { OutreachSettings } from "@/lib/api/types";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Outreach limits" };

/** How often and when outreach goes out: a cap on campaigns per patient, and quiet hours for text messages and push. */
export default async function OutreachSettingsPage() {
  const session = await getSession();
  if (!can(session, "crm.read")) redirect("/");
  const settings = await api<OutreachSettings>("/outreach/settings");
  return (
    <ModulePage
      title="Outreach limits"
      description="How often a patient can hear from the clinic, and the hours text messages and push notices are held back. Both are off until you set them."
      actions={
        <Link href="/outreach" className="text-table text-primary hover:underline">
          Outreach
        </Link>
      }
    >
      <SettingsForm settings={settings} canEdit={can(session, "crm.campaign.approve")} />
    </ModulePage>
  );
}
