import { redirect } from "next/navigation";
import { StaffSettingsPage } from "@/components/settings-page";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { StaffTourSetting } from "@/lib/api/types";
import { TourSwitch } from "./tour-switch";

export const metadata = { title: "Guided tour" };

export default async function GuidedTourSettingsPage() {
  const session = await getSession();
  if (!can(session, "organization.manage")) redirect("/");
  const setting = await api<StaffTourSetting>("/organization/tour-setting");
  return (
    <StaffSettingsPage
      group="Organization"
      title="Guided tour"
      description="Whether staff are offered a short walk through the app."
      details={[
        "The tour is shown once per browser and holds no patient information. Staff can still turn it off for themselves on My account; this switch turns it off for everyone.",
      ]}
    >
      <TourSwitch setting={setting} />
    </StaffSettingsPage>
  );
}
