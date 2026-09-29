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
import { percentOf, rangePresets } from "@/lib/management-mapping";
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
  const c = data.clinic;
  const b = data.billing;
  const l = data.laboratory;

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

        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure label="Patients seen" value={c.encounters.patientsSeen.toLocaleString("en-PH")}>
            {data.patients.registered.toLocaleString("en-PH")} new · {percentOf(data.patients.returningRate)} returning
          </Figure>
          <Figure label="Consultations" value={c.encounters.completed.toLocaleString("en-PH")}>
            {c.encounters.telemedicine.toLocaleString("en-PH")} online · {data.dental.procedures.toLocaleString("en-PH")} dental procedures
          </Figure>
          <Figure label="No-show rate" value={percentOf(c.appointments.noShowRate)}>
            {c.appointments.noShow} of {c.appointments.booked} booked · {c.appointments.cancelled} cancelled
          </Figure>
          <Figure label="Average wait" value={minutesLabel(c.visits.averageWaitMinutes)}>
            check-in to consultation · {c.visits.checkedIn} checked in, {c.visits.leftWithoutBeingSeen} left unseen
          </Figure>
          <Figure label="Invoiced (net)" value={peso(b.invoices.netTotal)}>
            {b.invoices.issued} invoices · {peso(b.invoices.discountTotal)} discounts
          </Figure>
          <Figure label="Collected" value={peso(b.netCollected)}>
            {peso(b.collectedTotal)} received · {peso(b.refundedTotal)} refunded
          </Figure>
          <Figure label="Lab tests released" value={l.released.toLocaleString("en-PH")}>
            {l.testsOrdered} ordered · {l.specimensRejected} specimens rejected
          </Figure>
          <Figure label="Lab turnaround" value={minutesLabel(l.averageTurnaroundMinutes)}>
            collection to release · {percentOf(l.withinTargetRate)} within the test&apos;s target
          </Figure>
        </section>

        <ManagementCharts daily={data.daily} />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top services by revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleTable
                empty="No invoiced services."
                head={["Service", "Qty", "Net"]}
                rows={b.topServices.map((s) => [
                  <span key="n">
                    {s.name} <span className="text-meta text-muted-foreground">· {CATEGORY_LABEL[s.category]}</span>
                  </span>,
                  s.quantity.toLocaleString("en-PH"),
                  peso(s.net),
                ])}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Revenue by category</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SimpleTable
                empty="No invoiced services."
                head={["Category", "Qty", "Net"]}
                rows={b.byCategory.map((r) => [CATEGORY_LABEL[r.category], r.quantity.toLocaleString("en-PH"), peso(r.net)])}
              />
              <SimpleTable
                empty="No payments recorded."
                head={["Payment method", "Payments", "Received", "Refunded"]}
                rows={b.collections.map((r) => [METHOD_LABEL[r.method], r.payments.toLocaleString("en-PH"), peso(r.collected), peso(r.refunded)])}
              />
              <p className="text-meta text-muted-foreground">
                Credit notes {peso(b.creditNotesTotal)} · debit notes {peso(b.debitNotesTotal)} · payer share of invoices {peso(b.invoices.payerTotal)} ·{" "}
                {b.invoices.voided} voided
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Providers</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleTable
                empty="No consultations or appointments."
                head={["Practitioner", "Consultations", "Patients", "Booked", "No-shows"]}
                rows={c.providers.map((p) => [
                  p.displayName,
                  p.encounters.toLocaleString("en-PH"),
                  p.patients.toLocaleString("en-PH"),
                  p.appointments.toLocaleString("en-PH"),
                  p.noShows.toLocaleString("en-PH"),
                ])}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Laboratory</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SimpleTable
                empty="No tests ordered."
                head={["Most ordered tests", "Ordered"]}
                rows={l.topTests.map((t) => [t.name, t.ordered.toLocaleString("en-PH")])}
              />
              <p className="text-meta text-muted-foreground">
                {l.orders.orders} orders ({l.orders.stat} STAT, {l.orders.cancelled} cancelled) · {l.corrections} corrections released
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Figure({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <Card className="p-3">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="tabular text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-meta text-muted-foreground">{children}</p>
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
            <TableHead key={h} className={i === 0 ? undefined : "text-right"}>
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
