import { notFound, redirect } from "next/navigation";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { TelemedicineConsultation } from "@/lib/api/types";
import { PreConsult } from "./pre-consult";

// Never put patient names in the tab title.
export const metadata = { title: "Online consultation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConsultationPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const [{ appointmentId }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "telemedicine.read")) redirect("/");
  if (!UUID.test(appointmentId)) notFound();
  let consultation: TelemedicineConsultation;
  try {
    consultation = await api<TelemedicineConsultation>(`/telemedicine/consultations/${appointmentId}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  if (consultation.session.encounterId) redirect(`/clinic/encounters/${consultation.session.encounterId}`);
  return (
    <>
      <PageHeader title="Online consultation" description={`${consultation.appointment.visitType} with ${consultation.appointment.practitionerName}`} />
      <PreConsult consultation={consultation} canConduct={can(session, "telemedicine.conduct") && can(session, "encounter.write")} />
    </>
  );
}
