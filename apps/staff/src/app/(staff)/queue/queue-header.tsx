"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarIcon, MonitorIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { Button, NativeSelect, toast } from "@healthcare/ui/primitives";
import { selectFacility } from "@/app/(staff)/actions";
import { LiveIndicator } from "@/components/live-queue";
import type { LiveStatus } from "@/lib/live-queue";
import type { ServicePoint } from "@/lib/api/types";
import { ServicePointSwitcher } from "./service-point-switcher";

/** What the page knows about where and what the board shows; the header turns it into chips and buttons. */
export interface QueueChrome {
  facilities: { id: string; name: string }[];
  facilityId: string;
  /** "Today, Oct 21": the queue is always today's, in the facility's time zone. */
  dateLabel: string;
  selectedServicePointId: string;
  /** May open the waiting-room display (`clinic.queue.display`). */
  canOpenDisplay: boolean;
  /** May check a patient in: manage the queue and search patients. */
  canCheckIn: boolean;
}

const CHIP = "inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 text-meta font-medium";

/** Title, live status, the facility / service point / day chips, and the two things a desk does most: open the display, check someone in. */
export function QueueHeader({
  chrome,
  servicePoints,
  live,
  updated,
  onRefresh,
}: {
  chrome: QueueChrome;
  servicePoints: ServicePoint[];
  live: LiveStatus;
  updated: string;
  onRefresh: () => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-start gap-3 border-b bg-card px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-page font-semibold tracking-tight">Queue</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success-subtle px-2 py-0.5">
            <LiveIndicator status={live} />
            <span className="text-meta text-muted-foreground">· updated {updated}</span>
          </span>
          <Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label="Refresh the queue" title="Refresh the queue">
            <RefreshCwIcon />
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <FacilityChip facilities={chrome.facilities} facilityId={chrome.facilityId} />
          {servicePoints.length > 0 ? <ServicePointSwitcher servicePoints={servicePoints} selectedId={chrome.selectedServicePointId} /> : null}
          <span className={CHIP}>
            <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
            {chrome.dateLabel}
          </span>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {chrome.canOpenDisplay ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/display/queue" target="_blank" rel="noopener">
              <MonitorIcon /> Waiting-room display
            </Link>
          </Button>
        ) : null}
        {chrome.canCheckIn ? (
          <Button asChild size="sm">
            <Link href="/patients">
              <SearchIcon /> Check in patient
            </Link>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

/** The facility the board belongs to: the same choice as the top bar's selector; a fixed chip when there is only one. */
function FacilityChip({ facilities, facilityId }: { facilities: { id: string; name: string }[]; facilityId: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  if (facilities.length < 2) return <span className={CHIP}>{facilities.find((f) => f.id === facilityId)?.name ?? "Facility"}</span>;
  return (
    <NativeSelect
      aria-label="Facility"
      className="[&_select]:h-7 [&_select]:rounded-md [&_select]:bg-muted/50 [&_select]:text-meta [&_select]:font-medium"
      value={facilityId}
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value;
        startTransition(async () => {
          try {
            await selectFacility(id);
            // The service point in the address belonged to the facility just left.
            router.push("/queue");
            router.refresh();
          } catch {
            toast.error("Could not switch facility.");
          }
        });
      }}
    >
      {facilities.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </NativeSelect>
  );
}
