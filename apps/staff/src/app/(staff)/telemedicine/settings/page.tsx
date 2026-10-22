import { redirect } from "next/navigation";
import { StaffSettingsPage } from "@/components/settings-page";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { TelemedicineSetting, VideoReadiness } from "@/lib/api/types";
import { TelemedicineSettingForm } from "./telemedicine-setting-form";

export const metadata = { title: "Online consultations" };

export default async function TelemedicineSettingsPage() {
  const session = await getSession();
  if (!can(session, "clinic.configure")) redirect("/");
  const [setting, video] = await Promise.all([
    api<TelemedicineSetting>("/telemedicine/settings"),
    // A failed probe only means no status line.
    api<VideoReadiness>("/telemedicine/consultations/video-status").catch(() => null),
  ]);
  return (
    <StaffSettingsPage
      group="Clinical"
      title="Online consultations"
      description="Video, and whether an online visit is paid for before the waiting room opens."
      details={[
        "Payment before the call charges the online visit when the patient asks for the waiting room, using the service your billing settings map to the visit type. The patient pays in MyHealth when online payment is set up, or at the cashier; the waiting room opens once the invoice is settled. A visit type with no priced service is not charged.",
        "A refund for a visit that did not take place is the cashier's, with the usual refund or void.",
      ]}
    >
      <TelemedicineSettingForm setting={setting} video={video} />
    </StaffSettingsPage>
  );
}
