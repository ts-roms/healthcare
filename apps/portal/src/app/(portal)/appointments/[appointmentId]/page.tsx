import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, PhoneIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { VisitCard } from "@/components/visit-card";
import { portalApi } from "@/lib/api/client";
import type { BookingOptions, PortalAppointments } from "@/lib/api/types";
import { rulesFor } from "@/lib/booking";
import { ChangeAppointment } from "./change-appointment";

export const metadata = { title: "Change a visit" };

export default async function AppointmentPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params;
  const [{ upcoming }, options] = await Promise.all([
    portalApi<PortalAppointments>("/portal/appointments"),
    portalApi<BookingOptions>("/portal/booking/options"),
  ]);
  const visit = upcoming.find((v) => v.id === appointmentId);
  if (!visit) notFound();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/appointments" className="mb-2 inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3.5" aria-hidden /> Visits
        </Link>
        <h1 className="text-page-lg font-semibold">Change a visit</h1>
      </div>
      <VisitCard visit={visit} />
      {visit.canCancel || visit.canReschedule ? (
        <ChangeAppointment
          visit={visit}
          rules={rulesFor(options, visit.facilityId)}
          practitioners={options.facilities.find((f) => f.id === visit.facilityId)?.practitioners ?? []}
        />
      ) : (
        <EmptyState icon={PhoneIcon} title="Please call the clinic">
          This visit can no longer be changed online.
        </EmptyState>
      )}
    </div>
  );
}
