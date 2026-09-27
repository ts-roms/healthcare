import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { portalApi } from "@/lib/api/client";
import type { PortalTeleconsult } from "@/lib/api/types";
import { ConsultRoom } from "./consult-room";

export const metadata = { title: "Online consultation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConsultationPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params;
  if (!UUID.test(appointmentId)) notFound();
  let consult: PortalTeleconsult;
  try {
    consult = await portalApi<PortalTeleconsult>(`/portal/teleconsults/${appointmentId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
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
