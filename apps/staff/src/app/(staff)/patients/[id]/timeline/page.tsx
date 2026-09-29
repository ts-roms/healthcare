import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, CheckIcon, FilterXIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { WithheldNote } from "@/components/patient-timeline-view";
import { api } from "@/lib/api/client";
import type { PatientDetail, PatientTimelinePage } from "@/lib/api/types";
import { parseTimelineFilters, TIMELINE_GROUPS, timelineApiQuery, timelineHref, toggleGroup } from "@/lib/timeline-mapping";
import { TimelineList } from "./timeline-list";

// Never put patient names in the tab title.
export const metadata = { title: "Patient timeline" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = { groups?: string | string[]; from?: string | string[]; to?: string | string[] };

/**
 * The patient's whole record as one chronological list (Patient 360 timeline), reached from the patient record.
 * Filters live in the URL (kind chips, date range); further pages load in place. The API shows each kind only to
 * users who may read that domain and says when some were withheld; every view is audited.
 */
export default async function PatientTimelinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const filters = parseTimelineFilters(query);
  const tolerate404 = (error: unknown): never => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  };
  const [patient, page] = await Promise.all([
    api<PatientDetail>(`/patients/${id}`).catch(tolerate404),
    api<PatientTimelinePage>(`/patients/${id}/timeline`, { query: timelineApiQuery(filters) }).catch(tolerate404),
  ]);
  const filtered = filters.groups.length > 0 || filters.from !== null || filters.to !== null;

  return (
    <>
      <PageHeader
        title="Timeline"
        description={
          <>
            {patient.displayName} · <span className="font-mono">{patient.patientNumber}</span> · newest first, times in the facility&apos;s time zone
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/patients/${id}`}>
              <ArrowLeftIcon aria-hidden /> Patient record
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 rounded-md border bg-card p-3">
          <nav aria-label="Show kinds of records" className="flex flex-wrap gap-1.5">
            {TIMELINE_GROUPS.map((g) => {
              const on = filters.groups.includes(g.key);
              return (
                <Button key={g.key} asChild size="sm" variant={on ? "default" : "outline"}>
                  <Link href={timelineHref(id, toggleGroup(filters, g.key))} aria-pressed={on}>
                    {on ? <CheckIcon aria-hidden /> : null}
                    {g.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
          <form method="get" action={`/patients/${id}/timeline`} className="flex flex-wrap items-end gap-3">
            {filters.groups.length ? <input type="hidden" name="groups" value={filters.groups.join(",")} /> : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor="timeline-from">From</Label>
              <Input id="timeline-from" name="from" type="date" defaultValue={filters.from ?? ""} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="timeline-to">To</Label>
              <Input id="timeline-to" name="to" type="date" defaultValue={filters.to ?? ""} className="w-40" />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Apply dates
            </Button>
            {filtered ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={timelineHref(id, { groups: [], from: null, to: null })}>
                  <FilterXIcon aria-hidden /> Clear filters
                </Link>
              </Button>
            ) : null}
          </form>
        </div>
        <WithheldNote withheld={page.withheld} />
        <TimelineList key={timelineHref(id, filters)} patientId={id} filters={filters} initial={page} />
        <p className="text-meta text-muted-foreground">
          Each entry is a summary; open it for the full record. Records entered in error, cancelled or voided stay listed and are marked. Viewing the timeline
          is recorded in the audit trail.
        </p>
      </div>
    </>
  );
}
