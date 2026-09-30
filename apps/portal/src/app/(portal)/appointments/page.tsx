import Link from "next/link";
import { CalendarIcon, CalendarPlusIcon, CheckCircle2Icon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { EmptyState } from "@/components/empty-state";
import { VisitCard } from "@/components/visit-card";
import { portalApi } from "@/lib/api/client";
import type { BookingOptions, PortalAppointments, PortalWaitlistEntry } from "@/lib/api/types";
import { WaitlistList } from "./waitlist-list";

const DONE = { booked: "Your visit is booked.", moved: "Your visit was moved.", cancelled: "Your visit was cancelled." } as const;

export const metadata = { title: "Visits" };

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<Partial<Record<keyof typeof DONE, string>>> }) {
  const [{ upcoming, past }, options, waiting, done] = await Promise.all([
    portalApi<PortalAppointments>("/portal/appointments"),
    portalApi<BookingOptions>("/portal/booking/options"),
    portalApi<PortalWaitlistEntry[]>("/portal/booking/waitlist"),
    searchParams,
  ]);
  const canBook = options.visitTypes.length > 0 && options.facilities.length > 0;
  const message = (Object.keys(DONE) as Array<keyof typeof DONE>).find((k) => done[k]);
  return (
    <div className="flex flex-col gap-5">
      {message ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-subtle p-4 text-body text-success-foreground">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
          {DONE[message]} {message === "cancelled" ? "" : "We will send you a confirmation and a reminder."}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        <h1 className="text-page-lg font-semibold">Visits</h1>
        <p className="text-body text-muted-foreground">
          {canBook ? "Book, change or cancel visits here, or contact the clinic." : "To book, change or cancel a visit, contact the clinic."} For an online
          consultation, open it below to answer the questions and join.
        </p>
        {canBook ? (
          <Button asChild size="lg" className="self-start">
            <Link href="/appointments/book">
              <CalendarPlusIcon /> Book a visit
            </Link>
          </Button>
        ) : null}
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-section-lg font-semibold">Upcoming</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarIcon} title="No upcoming visits">
            Visits you or the clinic book appear here.
          </EmptyState>
        ) : (
          upcoming.map((v) => <VisitCard key={v.id} visit={v} upcoming />)
        )}
      </section>
      {waiting.length ? <WaitlistList entries={waiting} /> : null}
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
