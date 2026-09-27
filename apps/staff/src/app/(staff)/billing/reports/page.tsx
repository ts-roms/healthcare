import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { DailyAccountFigures, DailyBillingReport } from "@/lib/api/types";
import { METHOD_LABEL, peso } from "@/lib/billing-mapping";
import { shiftDate, todayIn } from "@/lib/clinic-mapping";
import { BillingNav } from "../billing-nav";

export const metadata = { title: "Daily billing report" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** End-of-day figures for the cashier and the clinic manager: what was billed, discounted, collected and is still owed. */
export default async function DailyReportPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "billing.report.read")) redirect("/billing");
  const nav = <BillingNav canReport canConfigure={can(session, "billing.pricelist.manage")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Daily billing report" actions={nav} />
        <FacilityRequired action="Reports are per facility." />
      </>
    );
  }
  const today = todayIn(facility.timezone);
  const date = params.date && DATE.test(params.date) ? params.date : today;
  const r = await api<DailyBillingReport & DailyAccountFigures>("/billing/reports/daily", { query: { date } });
  return (
    <>
      <PageHeader
        title="Daily billing report"
        description={`${facility.name} · ${clinicalDate(date)}${date === today ? " (today)" : ""}`}
        actions={
          <>
            <nav aria-label="Change day" className="flex items-center gap-1">
              <Button asChild variant="outline" size="icon-sm">
                <Link href={`/billing/reports?date=${shiftDate(date, -1)}`} aria-label="Previous day">
                  <ChevronLeftIcon />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/billing/reports">Today</Link>
              </Button>
              <Button asChild variant="outline" size="icon-sm">
                <Link href={`/billing/reports?date=${shiftDate(date, 1)}`} aria-label="Next day">
                  <ChevronRightIcon />
                </Link>
              </Button>
            </nav>
            {nav}
          </>
        }
      />
      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
        <Figures
          title="Invoices issued"
          rows={[
            ["Issued", String(r.invoices.issued)],
            ["Voided", String(r.invoices.voided)],
            ["Gross", peso(r.invoices.grossTotal)],
            ["Discounts", peso(r.invoices.discountTotal)],
            ["Net", peso(r.invoices.netTotal)],
            ["Payers' share", peso(r.invoices.payerTotal)],
            ["Patients' share", peso(r.invoices.patientTotal)],
          ]}
        />
        <Figures
          title="Collections"
          rows={[
            ...r.collections.map((c): [string, string] => [`${METHOD_LABEL[c.method]} (${c.count})`, peso(c.amount)]),
            ["Total collected", peso(r.collectedTotal)],
            ...r.refunds.map((c): [string, string] => [`Refunds · ${METHOD_LABEL[c.method]} (${c.count})`, `−${peso(c.amount)}`]),
            ["Net collected", peso(r.collectedTotal - r.refundedTotal)],
          ]}
        />
        <Figures
          title="Still owed (all dates)"
          rows={[
            ["By patients", peso(r.receivables.patientBalance)],
            ["Invoices with a balance", String(r.receivables.invoices)],
            ["By payers (not yet settled)", peso(r.receivables.payerPending)],
            ["Deposits and credit held for patients", peso(r.deposits.held)],
          ]}
        />
        <Figures
          title="Deposits"
          rows={[
            ...r.deposits.received.map((c): [string, string] => [`${METHOD_LABEL[c.method]} (${c.count})`, peso(c.amount)]),
            ["Total received", peso(r.deposits.receivedTotal)],
            ["Applied to invoices", peso(r.deposits.appliedTotal)],
            ...r.deposits.refunds.map((c): [string, string] => [`Refunds · ${METHOD_LABEL[c.method]} (${c.count})`, `−${peso(c.amount)}`]),
          ]}
        />
        <Figures
          title="Credit notes issued"
          rows={
            r.creditNotes.count
              ? [
                  ["Credit notes", String(r.creditNotes.count)],
                  ["Total credited", peso(r.creditNotes.amount)],
                  ["Taken off balances", peso(r.creditNotes.appliedAmount)],
                  ["To patients' accounts (already paid)", peso(r.creditNotes.accountCredit)],
                ]
              : [["None", "—"]]
          }
        />
        <Figures
          title="Discounts given"
          rows={r.discounts.length ? r.discounts.map((d): [string, string] => [`${d.name} (${d.count})`, peso(d.amount)]) : [["None", "—"]]}
        />
      </div>
    </>
  );
}

function Figures({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className={label.startsWith("Total") || label.startsWith("Net") ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
