import Link from "next/link";
import { redirect } from "next/navigation";
import { DownloadIcon, InfoIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { DeliveryStatus } from "@/components/communications/delivery-status";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { CommunicationLogEntry, CommunicationSummary, Page } from "@/lib/api/types";
import {
  CATEGORY_LABEL,
  CHANNEL_LABEL,
  communicationApiQuery,
  communicationHref,
  MAX_DAYS,
  readCommunicationFilters,
  shareText,
  STATUS_FILTERS,
  suppressionReasonText,
} from "@/lib/communications";
import { todayInManila } from "@/lib/consent-form";

export const metadata = { title: "Communications" };

function Figure({ label, value, hint }: { label: string; value: string | number; hint?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-card p-3">
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className="text-page font-semibold">{value}</span>
      {hint ? <span className="text-meta text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * The communication log: what the platform sent, or did not send, to patients — which kind of message, how, and what
 * became of it — never the message itself. Viewing it and exporting it are audited.
 */
export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "notification.read")) redirect("/");
  const canSeePatients = can(session, "patient.read");
  const { filters, adjusted } = readCommunicationFilters(params, todayInManila());
  const [summary, page] = await Promise.all([
    api<CommunicationSummary>("/communications/summary", { query: { from: filters.from, to: filters.to } }),
    canSeePatients ? api<Page<CommunicationLogEntry>>("/communications", { query: communicationApiQuery(filters) }) : Promise.resolve(null),
  ]);
  const notSent = summary.byStatus.failed + summary.byStatus.suppressed + summary.byStatus.cancelled;
  const reached = summary.byStatus.sent + summary.byStatus.delivered;
  const waiting = summary.byStatus.queued + summary.byStatus.sending;
  const templates = summary.byTemplate.some((t) => t.templateKey === filters.template)
    ? summary.byTemplate
    : [...summary.byTemplate, ...(filters.template ? [{ templateKey: filters.template, templateLabel: filters.template, total: 0, notSent: 0 }] : [])];

  return (
    <>
      <PageHeader
        title="Communications"
        description="Messages the clinic sent, or could not send, to patients: reminders, notices and MyHealth alerts. The content of messages is never shown here."
      />
      <div className="flex flex-col gap-4 p-4">
        <form method="get" className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="grid gap-1">
            <Label htmlFor="comm-from">From (day)</Label>
            <Input id="comm-from" name="from" type="date" defaultValue={filters.from} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="comm-to">To (day)</Label>
            <Input id="comm-to" name="to" type="date" defaultValue={filters.to} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="comm-status">Status</Label>
            <NativeSelect id="comm-status" name="status" defaultValue={filters.status}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="comm-channel">Channel</Label>
            <NativeSelect id="comm-channel" name="channel" defaultValue={filters.channel}>
              <option value="">Any channel</option>
              {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="comm-category">Kind</Label>
            <NativeSelect id="comm-category" name="category" defaultValue={filters.category}>
              <option value="">Any kind</option>
              {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="comm-template">Message</Label>
            <NativeSelect id="comm-template" name="template" defaultValue={filters.template} emptyText="None in this period">
              <option value="">Any message</option>
              {templates.map((t) => (
                <option key={t.templateKey} value={t.templateKey}>
                  {t.templateLabel}
                </option>
              ))}
            </NativeSelect>
          </div>
          {filters.patient ? <input type="hidden" name="patient" value={filters.patient} /> : null}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-3 lg:col-span-6">
            <Button type="submit" size="sm">
              Show
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/communications">Clear</Link>
            </Button>
            {filters.patient ? (
              <span className="text-meta text-muted-foreground">
                One patient only ·{" "}
                <Link className="text-primary hover:underline" href={communicationHref({ ...filters, patient: "" }, 1)}>
                  show everyone
                </Link>
              </span>
            ) : null}
            {canSeePatients ? (
              <Button asChild size="sm" variant="outline" className="ml-auto">
                <a href={communicationHref(filters, 1, "/communications/export")}>
                  <DownloadIcon aria-hidden /> Download CSV
                </a>
              </Button>
            ) : null}
          </div>
          {adjusted ? (
            <p className="flex items-center gap-1.5 text-meta text-muted-foreground sm:col-span-3 lg:col-span-6">
              <InfoIcon className="size-3.5" aria-hidden /> A period is at most {MAX_DAYS} days; showing the last {MAX_DAYS} days to {filters.to}.
            </p>
          ) : null}
        </form>

        <section aria-label="Summary" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Messages to patients" value={summary.total} hint={`${filters.from} to ${filters.to}`} />
          <Figure label="Sent or delivered" value={reached} hint={shareText(reached, summary.total)} />
          <Figure label="Not sent, failed or cancelled" value={notSent} hint={shareText(notSent, summary.total)} />
          <Figure label="Waiting to send" value={waiting} />
        </section>

        {summary.suppressedByReason.length || summary.byChannel.length ? (
          <section aria-label="Breakdown" className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-md border bg-card p-3">
              <h2 className="mb-1 text-table font-semibold">By channel</h2>
              <ul className="flex flex-col gap-0.5 text-table">
                {summary.byChannel.map((c) => (
                  <li key={c.channel} className="flex justify-between gap-2">
                    <span>{CHANNEL_LABEL[c.channel]}</span>
                    <span className="text-muted-foreground">
                      {c.total} · {c.sent} sent · {c.notSent} not sent
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border bg-card p-3">
              <h2 className="mb-1 text-table font-semibold">Why messages were not sent</h2>
              {summary.suppressedByReason.length ? (
                <ul className="flex flex-col gap-0.5 text-table">
                  {summary.suppressedByReason.map((r) => (
                    <li key={r.reason} className="flex justify-between gap-2">
                      <span>{suppressionReasonText(r.reason)}</span>
                      <span className="text-muted-foreground">{r.total}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-table text-muted-foreground">None held back by consent or preferences.</p>
              )}
            </div>
            <div className="rounded-md border bg-card p-3">
              <h2 className="mb-1 text-table font-semibold">By message</h2>
              <ul className="flex flex-col gap-0.5 text-table">
                {summary.byTemplate.slice(0, 8).map((t) => (
                  <li key={t.templateKey} className="flex justify-between gap-2">
                    <Link className="text-primary hover:underline" href={communicationHref({ ...filters, template: t.templateKey, page: 1 }, 1)}>
                      {t.templateLabel}
                    </Link>
                    <span className="text-muted-foreground">
                      {t.total}
                      {t.notSent ? ` · ${t.notSent} not sent` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {page === null ? (
          <p className="text-table text-muted-foreground">The list of messages names patients; it is shown to staff who may read patient records.</p>
        ) : page.items.length === 0 ? (
          <p className="text-table text-muted-foreground">No messages match.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap">
                    {clinicalDateTime(m.createdAt)}
                    {m.scheduledFor ? <span className="block text-meta text-muted-foreground">for {clinicalDateTime(m.scheduledFor)}</span> : null}
                  </TableCell>
                  <TableCell>
                    {m.patient ? (
                      <Link className="text-primary hover:underline" href={`/patients/${m.patient.id}/communications`}>
                        {m.patient.displayName}
                        <span className="block font-mono text-meta text-muted-foreground">{m.patient.patientNumber}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Unknown patient</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    {m.templateLabel}
                    <span className="block text-meta text-muted-foreground">{CATEGORY_LABEL[m.category]}</span>
                  </TableCell>
                  <TableCell>
                    {CHANNEL_LABEL[m.channel]}
                    {m.destinationMasked ? <span className="block font-mono text-meta text-muted-foreground">{m.destinationMasked}</span> : null}
                  </TableCell>
                  <TableCell>
                    <DeliveryStatus status={m.status} reason={m.suppressionReason} />
                    {m.status === "failed" ? <span className="text-meta text-muted-foreground">after {m.attemptCount} attempts</span> : null}
                  </TableCell>
                  <TableCell>{m.requestedBy ? (m.requestedByName ?? "A staff member") : <span className="text-muted-foreground">Automatic</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {page ? (
          <nav aria-label="Pages" className="flex items-center gap-2 text-table">
            {filters.page > 1 ? (
              <Button asChild size="sm" variant="outline">
                <Link href={communicationHref(filters, filters.page - 1)}>Newer</Link>
              </Button>
            ) : null}
            <span className="text-muted-foreground">Page {filters.page}</span>
            {page.hasMore ? (
              <Button asChild size="sm" variant="outline">
                <Link href={communicationHref(filters, filters.page + 1)}>Older</Link>
              </Button>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}
