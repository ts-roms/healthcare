import Link from "next/link";
import { UserPlusIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";

/** What the page knows about today's appointments, for the empty board (null: not allowed to see them). */
export interface TodayAppointments {
  count: number;
  first: { time: string; patientName: string } | null;
}

const COLUMN_LABELS = ["Waiting", "Triage / Vitals", "Ready for provider", "With provider", "Done"];

/** The board with nobody on it: the empty columns folded into counts, and what to do next. */
export function EmptyQueue({ canCheckIn, today }: { canCheckIn: boolean; today: TodayAppointments | null }) {
  return (
    <>
      <ul className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" aria-label="Queue columns">
        {COLUMN_LABELS.map((label) => (
          <li key={label} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-table text-muted-foreground">
            <span>{label}</span>
            <span className="tabular font-semibold">0</span>
          </li>
        ))}
      </ul>
      <section className="flex min-h-[18rem] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card p-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <UserPlusIcon className="size-6" aria-hidden />
        </span>
        <h2 className="text-section font-semibold">No patients in the queue yet</h2>
        <p className="max-w-md text-body text-muted-foreground">
          Check in the first arrival and they&apos;ll appear under Waiting. The board and the waiting-room display update on their own.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {canCheckIn ? (
            <Button asChild>
              <Link href="/patients">Check in patient</Link>
            </Button>
          ) : null}
          {today ? (
            <Button asChild variant="secondary">
              <Link href="/appointments">View today&apos;s appointments ({today.count})</Link>
            </Button>
          ) : null}
        </div>
        {today?.first ? (
          <p className="text-table text-muted-foreground">
            First appointment: <span className="font-medium text-foreground">{today.first.time}</span> ·{" "}
            <span className="font-medium text-foreground">{today.first.patientName}</span>
          </p>
        ) : null}
      </section>
    </>
  );
}
