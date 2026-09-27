import Link from "next/link";
import { ArrowLeftIcon, CalendarOffIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import type { BookingOptions } from "@/lib/api/types";
import { BookingFlow } from "./booking-flow";

export const metadata = { title: "Book a visit" };

export default async function BookPage() {
  const options = await portalApi<BookingOptions>("/portal/booking/options");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/appointments" className="mb-2 inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3.5" aria-hidden /> Visits
        </Link>
        <h1 className="text-page-lg font-semibold">Book a visit</h1>
        <p className="text-body text-muted-foreground">
          Book at least {options.rules.minLeadMinutes / 60} hours ahead, up to {options.rules.maxAdvanceDays} days. For urgent care, call the clinic; in an
          emergency, call 911.
        </p>
      </div>
      {options.visitTypes.length === 0 || options.facilities.length === 0 ? (
        <EmptyState icon={CalendarOffIcon} title="Online booking is not available">
          Your clinic has not opened online booking yet. Please call the clinic to book a visit.
        </EmptyState>
      ) : (
        <BookingFlow options={options} />
      )}
    </div>
  );
}
