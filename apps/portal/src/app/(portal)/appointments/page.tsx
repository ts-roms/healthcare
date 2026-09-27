import { CalendarIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { VisitCard } from "@/components/visit-card";
import { portalApi } from "@/lib/api/client";
import type { PortalAppointments } from "@/lib/api/types";

export const metadata = { title: "Visits" };

export default async function AppointmentsPage() {
  const { upcoming, past } = await portalApi<PortalAppointments>("/portal/appointments");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Visits</h1>
        <p className="text-body text-muted-foreground">To book, change or cancel a visit, contact the clinic. Online booking is coming to MyHealth.</p>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-section-lg font-semibold">Upcoming</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarIcon} title="No upcoming visits">
            Visits booked with the clinic appear here.
          </EmptyState>
        ) : (
          upcoming.map((v) => <VisitCard key={v.id} visit={v} />)
        )}
      </section>
      {past.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-section-lg font-semibold">Past year</h2>
          {past.map((v) => (
            <VisitCard key={v.id} visit={v} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
