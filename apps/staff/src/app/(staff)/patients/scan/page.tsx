import { ModulePage } from "@/components/module-page";
import { redirect } from "next/navigation";
import { can, getSession } from "@/lib/api/session";
import { ScanQr } from "./scan-qr";

export const metadata = { title: "Scan patient QR code" };

export default async function ScanPatientQrPage() {
  const session = await getSession();
  if (!can(session, "patient.search")) redirect("/");
  return (
    <ModulePage title="Scan patient QR code" description="Scan a patient's card to find the record. Every scan is recorded.">
      <ScanQr canOpenRecord={can(session, "patient.read")} canCheckIn={can(session, "clinic.queue.manage")} />
    </ModulePage>
  );
}
