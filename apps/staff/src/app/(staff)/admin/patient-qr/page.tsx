import { StaffSettingsPage } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PatientQrSetting } from "@/lib/api/types";
import { PatientQrSettingForm } from "./patient-qr-setting-form";

export const metadata = { title: "Patient QR codes" };

export default async function PatientQrSettingsPage() {
  const session = await getSession();
  if (!can(session, "patient.qr.manage")) redirect("/");
  const setting = await api<PatientQrSetting>("/patient-qr/setting");
  return (
    <StaffSettingsPage
      group="Security & privacy"
      title="Patient QR codes"
      description="A QR code on the patient's card or wristband that staff scan to find the record."
      details={["It holds a key only, never health, contact or identity details."]}
    >
      <p className="rounded-md border border-dashed p-3 text-meta text-muted-foreground">
        Scanning needs a signed-in member of staff who may search patients, and every scan is recorded. A code grants no access by itself, including to
        MyHealth. Decide with your Data Protection Officer how cards are handed out and replaced; lost cards are revoked from the patient record.
      </p>
      <PatientQrSettingForm setting={setting} />
    </StaffSettingsPage>
  );
}
