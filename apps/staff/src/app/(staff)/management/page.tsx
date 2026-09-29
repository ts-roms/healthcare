import Link from "next/link";
import type { ReactNode } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import { clinicalDate } from "@healthcare/ui/healthcare";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { ManagementDashboard } from "@/lib/api/types";
import { CATEGORY_LABEL, METHOD_LABEL, peso } from "@/lib/billing-mapping";
import { todayIn } from "@/lib/clinic-mapping";
import { minutesLabel } from "@/lib/dashboard-mapping";
import { comparison, countLabel, EXPORT_TABLES, patientRateLabel, percentOf, previousLabel, rangePresets, verdict } from "@/lib/management-mapping";
import { ManagementCharts } from "./management-charts";

export const metadata = { title: "Management dashboard" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Operational figures across the organization's domains for a range of days (CLAUDE.md §28, management). */
export default async function ManagementPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; facilityId?: string }> }) {
  const [params, session, selected] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "management.dashboard.read")) redirect("/");
  const query = {
    from: params.from && DATE.test(params.from) ? params.from : undefined,
    to: params.to && DATE.test(params.to) ? params.to : undefined,
    facilityId: params.facilityId && UUID.test(params.facilityId) ? params.facilityId : undefined,
  };
  let data: ManagementDashboard;
  try {
    data = await api<ManagementDashboard>("/management/dashboard", { query });
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof ApiError) || error.status >= 500) throw error;
    return (
      <>
        <PageHeader title="Management dashboard" />
        <p className="p-4 text-body text-danger">{error.message}</p>
        <p className="px-4">
          <Link href="/management" className="text-primary hover:underline">
            Back to the last 30 days
          </Link>
        </p>
      </>
    );
  }
  const scope =
    data.facilityIds === null
      ? "All facilities"
      : data.facilityIds.map((id) => data.facilities.find((f) => f.id === id)?.name ?? "Facility").join(", ") || "No facilities";
  const today = todayIn(data.timeZone);
  const facilityParam = query.facilityId ? `&facilityId=${query.facilityId}` : "";
  const k = data.keyFigures;
  const prev = data.previous.keyFigures;
  const versus = `vs ${previousLabel(data.previous.from, data.previous.to)}`;
  const exportQuery = `from=${data.from}&to=${data.to}${facilityParam}`;
  const changes = data.previous.changes;
  const d = data.definitions;
  const c = data.clinic;
  const b = data.billing;
  const l = data.laboratory;
  const t = data.telemedicine;
  const r = data.retention;

  return (
    <>
      <PageHeader
        title="Management dashboard"
        description={`${scope} · ${clinicalDate(`${data.from}T12:00:00Z`)} to ${clinicalDate(`${data.to}T12:00:00Z`)}. Operational figures, not official or BIR reports.`}
      />
      <div className="flex flex-col gap-4 p-4">
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filters">
          <div className="grid gap-1">
            <Label htmlFor="mgmt-from">From</Label>
            <Input id="mgmt-from" name="from" type="date" defaultValue={data.from} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mgmt-to">To</Label>
            <Input id="mgmt-to" name="to" type="date" defaultValue={data.to} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mgmt-facility">Facility</Label>
            <NativeSelect id="mgmt-facility" name="facilityId" defaultValue={query.facilityId ?? (data.wholeOrganization ? "" : (selected?.id ?? ""))}>
              {data.wholeOrganization ? <option value="">All facilities</option> : null}
              {data.facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" size="sm">
            Apply
          </Button>
          <nav aria-label="Quick ranges" className="flex flex-wrap gap-1">
            {rangePresets(today).map((p) => {
              const active = p.from === data.from && p.to === data.to;
              return (
                <Button key={p.key} asChild size="sm" variant={active ? "secondary" : "ghost"}>
                  <Link href={`/management?from=${p.from}&to=${p.to}${facilityParam}`} aria-current={active ? "true" : undefined}>
                    {p.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </form>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
          <span>Download CSV:</span>
          {EXPORT_TABLES.filter((t) => b !== null || !t.revenue).map((t) => (
            <a key={t.key} href={`/management/export?table=${t.key}&${exportQuery}`} download className="text-primary hover:underline">
              {t.label}
            </a>
          ))}
        </p>
        <p className="text-meta text-muted-foreground">
          Patient counts under {data.suppressionThreshold} are shown as “&lt;{data.suppressionThreshold}” to protect privacy; rates built on them are withheld.
        </p>

        {b === null ? (
          <p role="note" className="rounded-md border border-border bg-muted p-3 text-body">
            Revenue, collections and service revenue are not shown: they need billing report access for every facility in scope.
          </p>
        ) : null}

        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure
            label="Patients seen"
            value={countLabel(k.patientsSeen)}
            change={comparison(k.patientsSeen, prev.patientsSeen, "count")}
            assessment={verdict(changes.patientsSeen)}
            versus={versus}
            definition={d.patientsSeen}
          >
            {countLabel(data.patients.registered)} new · {patientRateLabel(data.patients.returningRate, data.patients.returningRateSuppressed)} returning
          </Figure>
          <Figure
            label="Consultations"
            value={k.consultations.toLocaleString("en-PH")}
            change={comparison(k.consultations, prev.consultations, "count")}
            assessment={verdict(changes.consultations)}
            versus={versus}
            definition={d.consultations}
          >
            {c.encounters.telemedicine.toLocaleString("en-PH")} online · {data.dental.procedures.toLocaleString("en-PH")} dental procedures
          </Figure>
          <Figure
            label="No-show rate"
            value={percentOf(k.noShowRate)}
            change={comparison(k.noShowRate, prev.noShowRate, "rate")}
            assessment={verdict(changes.noShowRate)}
            versus={versus}
            definition={d.noShowRate}
          >
            {c.appointments.noShow} of {c.appointments.booked} booked · {c.appointments.cancelled} cancelled
          </Figure>
          <Figure
            label="Average wait"
            value={minutesLabel(k.averageWaitMinutes)}
            change={comparison(k.averageWaitMinutes, prev.averageWaitMinutes, "minutes")}
            assessment={verdict(changes.averageWaitMinutes)}
            versus={versus}
            definition={d.averageWait}
          >
            check-in to consultation · {c.visits.checkedIn} checked in, {c.visits.leftWithoutBeingSeen} left unseen
          </Figure>
          {b ? (
            <>
              <Figure
                label="Invoiced (net)"
                value={peso(b.invoices.netTotal)}
                change={comparison(k.netInvoiced, prev.netInvoiced, "count")}
                assessment={verdict(changes.netInvoiced)}
                versus={versus}
                definition={d.invoicedNet}
              >
                {b.invoices.issued} invoices · {peso(b.invoices.discountTotal)} discounts
              </Figure>
              <Figure
                label="Collected"
                value={peso(b.netCollected)}
                change={comparison(k.netCollected, prev.netCollected, "count")}
                assessment={verdict(changes.netCollected)}
                versus={versus}
                definition={d.collected}
              >
                {peso(b.collectedTotal)} received · {peso(b.refundedTotal)} refunded
              </Figure>
            </>
          ) : null}
          <Figure
            label="Lab tests released"
            value={k.labTestsReleased.toLocaleString("en-PH")}
            change={comparison(k.labTestsReleased, prev.labTestsReleased, "count")}
            assessment={verdict(changes.labTestsReleased)}
            versus={versus}
            definition={d.labReleased}
          >
            {l.testsOrdered} ordered · {l.corrections} corrections
          </Figure>
          <Figure
            label="Lab turnaround"
            value={minutesLabel(k.labTurnaroundMinutes)}
            change={comparison(k.labTurnaroundMinutes, prev.labTurnaroundMinutes, "minutes")}
            assessment={verdict(changes.labTurnaroundMinutes)}
            versus={versus}
            definition={d.labTurnaround}
          >
            collection to release · {percentOf(l.withinTargetRate)} within the test&apos;s target
          </Figure>
          <Figure
            label="Specimen rejection"
            value={percentOf(k.specimenRejectionRate)}
            change={comparison(k.specimenRejectionRate, prev.specimenRejectionRate, "rate")}
            assessment={verdict(changes.specimenRejectionRate)}
            versus={versus}
            definition={d.specimenRejectionRate}
          >
            {l.specimens.rejected} of {l.specimens.collected} collected
          </Figure>
          <Figure
            label="Retention"
            value={patientRateLabel(r.retentionRate, r.retentionRateSuppressed)}
            change={comparison(k.retentionRate, prev.retentionRate, "rate")}
            assessment={verdict(changes.retentionRate)}
            versus={versus}
            definition={d.retentionRate}
          >
            seen in the {r.lookbackMonths} months before · {countLabel(r.retained)} of {countLabel(r.seen)}
          </Figure>
          <Figure label="Schedule utilization" value={percentOf(c.utilization.rate)} definition={d.utilization}>
            {c.utilization.bookedMinutes.toLocaleString("en-PH")} of {c.utilization.availableMinutes.toLocaleString("en-PH")} scheduled minutes booked
          </Figure>
          <Figure label="Online consultations" value={t.started.toLocaleString("en-PH")} definition={d.telemedicine}>
            {t.escalated} escalated ({percentOf(t.escalationRate)} of finished) · {t.inProgress} in progress
          </Figure>
        </section>

        <ManagementCharts daily={data.daily} revenue={b !== null} />

        <div className="grid gap-4 lg:grid-cols-2">
          {b ? (
            <>
              <Section title="Top services by revenue">
                <SimpleTable
                  empty="No invoiced services."
                  head={["Service", "Qty", "Patients", "Net"]}
                  rows={b.topServices.map((s) => [
                    <span key="n">
                      {s.name} <span className="text-meta text-muted-foreground">· {CATEGORY_LABEL[s.category]}</span>
                    </span>,
                    s.quantity.toLocaleString("en-PH"),
                    countLabel(s.patients),
                    peso(s.net),
                  ])}
                />
              </Section>
              <Section title="Revenue by category">
                <SimpleTable
                  empty="No invoiced services."
                  head={["Category", "Qty", "Net"]}
                  rows={b.byCategory.map((row) => [CATEGORY_LABEL[row.category], row.quantity.toLocaleString("en-PH"), peso(row.net)])}
                />
                <SimpleTable
                  empty="No payments recorded."
                  head={["Payment method", "Payments", "Received", "Refunded"]}
                  rows={b.collections.map((row) => [METHOD_LABEL[row.method], row.payments.toLocaleString("en-PH"), peso(row.collected), peso(row.refunded)])}
                />
                <p className="text-meta text-muted-foreground">
                  Credit notes {peso(b.creditNotesTotal)} · debit notes {peso(b.debitNotesTotal)} · payer share of invoices {peso(b.invoices.payerTotal)} ·{" "}
                  {b.invoices.voided} voided
                </p>
              </Section>
            </>
          ) : null}
          <Section title="Providers" definition={d.utilization}>
            <SimpleTable
              empty="No consultations, appointments or schedules."
              head={["Practitioner", "Consultations", "Patients", "Booked", "No-shows", "Utilization"]}
              rows={c.providers.map((p) => [
                p.displayName,
                p.encounters.toLocaleString("en-PH"),
                countLabel(p.patients),
                p.appointments.toLocaleString("en-PH"),
                p.noShows.toLocaleString("en-PH"),
                percentOf(p.utilization),
              ])}
            />
          </Section>
          <Section title="Laboratory" definition={d.resultsPerInstrument}>
            <SimpleTable
              empty="No tests ordered."
              head={["Most ordered tests", "Ordered"]}
              rows={l.topTests.map((test) => [test.name, test.ordered.toLocaleString("en-PH")])}
            />
            <SimpleTable
              empty="No results entered."
              head={["Instrument", "First results entered"]}
              rows={l.byInstrument.map((i) => [i.name ?? "No instrument recorded", i.results.toLocaleString("en-PH")])}
            />
            <p className="text-meta text-muted-foreground">
              {l.orders.orders} orders ({l.orders.stat} STAT, {l.orders.cancelled} cancelled) · {l.specimensRejected} specimens rejected in the period
            </p>
          </Section>
          <Section title="Dental procedures" definition={d.dentalProcedures}>
            <SimpleTable
              empty="No dental procedures."
              head={["Procedure", "Done", "Patients"]}
              rows={data.dental.byProcedure.map((p) => [`${p.name} (${p.code})`, p.procedures.toLocaleString("en-PH"), countLabel(p.patients)])}
            />
            <p className="text-meta text-muted-foreground">
              {data.dental.procedures.toLocaleString("en-PH")} procedures · {countLabel(data.dental.patients)} patients treated
            </p>
          </Section>
          <Section title="Online consultations" definition={d.telemedicine}>
            <SimpleTable
              empty="No online consultations."
              head={["Started", "Ended", "Escalated", "In progress", "Escalation rate"]}
              rows={t.started ? [[t.started, t.ended, t.escalated, t.inProgress, percentOf(t.escalationRate)].map(String)] : []}
            />
          </Section>
          <Section title="Patient retention" definition={`${d.retentionRate} ${d.returnRate}`}>
            <SimpleTable
              empty="No patients seen."
              head={["", "Patients", "Of them", "Rate"]}
              rows={[
                [
                  `Also seen in the ${r.lookbackMonths} months before`,
                  countLabel(r.seen),
                  countLabel(r.retained),
                  patientRateLabel(r.retentionRate, r.retentionRateSuppressed),
                ],
                [
                  `Returned within ${r.returnWindowDays} days`,
                  countLabel(r.returnCohort),
                  countLabel(r.returned),
                  patientRateLabel(r.returnRate, r.returnRateSuppressed),
                ],
              ]}
            />
          </Section>
        </div>

        <details className="text-meta text-muted-foreground">
          <summary className="cursor-pointer">About these figures</summary>
          <p className="mt-1">{d.comparison}</p>
          <p className="mt-1">{d.suppression}</p>
        </details>
      </div>
    </>
  );
}

const TONE_CLASS = { better: "text-success", worse: "text-danger", neutral: "text-muted-foreground" } as const;

function Figure({
  label,
  value,
  change,
  assessment,
  versus,
  definition,
  children,
}: {
  label: string;
  value: string;
  /** Main's change text (arrow with percent, points or minutes); omitted for figures not compared. */
  change?: string;
  /** Better or worse by the figure's direction of improvement (arrow + words + colour, never colour alone). */
  assessment?: { text: string; tone: keyof typeof TONE_CLASS } | null;
  versus?: string;
  definition: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col p-3">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="tabular text-2xl font-semibold">{value}</p>
      {change !== undefined && versus ? (
        <p className="text-meta">
          {change === "no comparison" ? (
            <span className="text-muted-foreground">Nothing to compare {versus.replace(/^vs /, "with ")}</span>
          ) : (
            <>
              <span className={`font-medium ${assessment ? TONE_CLASS[assessment.tone] : ""}`}>
                {change}
                {assessment ? ` (${assessment.text})` : ""}
              </span>{" "}
              <span className="text-muted-foreground">{versus}</span>
            </>
          )}
        </p>
      ) : null}
      <p className="mt-1 text-meta text-muted-foreground">{children}</p>
      <details className="mt-auto pt-1 text-meta text-muted-foreground">
        <summary className="cursor-pointer">How is this calculated?</summary>
        <p className="mt-1">{definition}</p>
      </details>
    </Card>
  );
}

function Section({ title, definition, children }: { title: string; definition?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {children}
        {definition ? (
          <details className="text-meta text-muted-foreground">
            <summary className="cursor-pointer">How is this calculated?</summary>
            <p className="mt-1">{definition}</p>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-table text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h, i) => (
            <TableHead key={`${h}-${i}`} className={i === 0 ? undefined : "text-right"}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, r) => (
          <TableRow key={r}>
            {row.map((cell, i) => (
              <TableCell key={i} className={i === 0 ? undefined : "tabular text-right"}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
