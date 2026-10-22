import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { portalApi } from "@/lib/api/client";
import type { PortalAppointments, PortalTeleconsult } from "@/lib/api/types";
import { ConsultRoom } from "./consult-room";

export const metadata = { title: "Online consultation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConsultationPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params;
  if (!UUID.test(appointmentId)) notFound();
  let consult: PortalTeleconsult | null = null;
  try {
    consult = await portalApi<PortalTeleconsult>(`/portal/teleconsults/${appointmentId}`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  if (!consult) {
    // Not an online consultation of this patient. If it is one of their visits at the clinic (a link to the wrong page),
    // show that visit instead of "not found": still to come → its page; over → the list of visits.
    const { upcoming, past } = await portalApi<PortalAppointments>("/portal/appointments");
    if (upcoming.some((v) => v.id === appointmentId)) redirect(`/appointments/${appointmentId}`);
    if (past.some((v) => v.id === appointmentId)) redirect("/appointments");
    notFound();
  }
  return (
    <div className="flex flex-col gap-5">
      <Link href="/appointments" className="flex items-center gap-1 text-body font-medium text-primary">
        <ChevronLeftIcon className="size-4" aria-hidden /> Visits
      </Link>
      <ConsultRoom consult={consult} />
    </div>
  );
}
