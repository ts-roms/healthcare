import Link from "next/link";
import { ArrowRightIcon, CircleCheckBigIcon, ReceiptIcon, WalletIcon } from "lucide-react";
import { Badge, Button, EmptyState } from "@healthcare/ui/primitives";
import { clinicalDate } from "@healthcare/ui/healthcare";
import type { BillingWorklistRow, DailyBillingReport, InvoiceSummary } from "@/lib/api/types";
import { METHOD_LABEL, peso } from "@/lib/billing-mapping";

const MAX_ROWS = 6;

/** A dashboard card: title, an optional count and link, then the content. */
function Panel({ title, count, href, linkLabel, children }: { title: string; count?: number; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-section font-semibold">{title}</h2>
        {count ? <Badge variant="warning">{count}</Badge> : null}
        {href ? (
          <Link href={href} className="ml-auto text-table text-primary hover:underline">
            {linkLabel ?? "Open"}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Charges waiting to be invoiced, oldest first: the cashier's first job. Each row opens the patient's billing page. */
export function ToInvoice({ rows, canInvoice }: { rows: BillingWorklistRow[]; canInvoice: boolean }) {
  return (
    <Panel title="To invoice" count={rows.length} href="/billing" linkLabel="Cashier">
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={CircleCheckBigIcon}
          title="Nothing to invoice"
          description="Charges captured from consultations, laboratory orders and staff appear here."
        />
      ) : (
        <ul className="divide-y">
          {rows.slice(0, MAX_ROWS).map((r) => (
            <li key={r.patientId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-table">
              <span className="min-w-0 flex-1">
                <Link href={`/billing/patients/${r.patientId}`} className="font-semibold hover:underline">
                  {r.patient?.displayName ?? "Patient"}
                </Link>
                <span className="block text-meta text-muted-foreground">
                  {r.patient?.patientNumber ? `${r.patient.patientNumber} · ` : ""}
                  {r.count} {r.count === 1 ? "charge" : "charges"} since {clinicalDate(r.oldest)}
                </span>
              </span>
              <span className="tabular font-semibold">{peso(r.amount)}</span>
              {canInvoice ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/billing/patients/${r.patientId}`} aria-label={`Create an invoice for ${r.patient?.displayName ?? "the patient"}`}>
                    Create invoice <ArrowRightIcon aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {rows.length > MAX_ROWS ? <p className="border-t px-4 py-2 text-meta text-muted-foreground">{rows.length - MAX_ROWS} more at the cashier.</p> : null}
    </Panel>
  );
}

/** Issued invoices still owed, largest first. */
export function BalancesOwed({ invoices }: { invoices: InvoiceSummary[] }) {
  const owed = invoices.filter((i) => i.status === "issued" && i.balance > 0).sort((a, b) => b.balance - a.balance);
  return (
    <Panel title="Balances owed" count={owed.length} href="/billing/invoices" linkLabel="Invoices">
      {owed.length === 0 ? (
        <EmptyState compact icon={WalletIcon} title="Every invoice is paid" />
      ) : (
        <ul className="divide-y">
          {owed.slice(0, MAX_ROWS).map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-table">
              <span className="min-w-0 flex-1">
                <Link href={`/billing/invoices/${i.id}`} className="font-mono font-medium hover:underline">
                  {i.invoiceNumber ?? "Draft"}
                </Link>
                <span className="block truncate text-meta text-muted-foreground">{i.patient?.displayName ?? "Patient"}</span>
              </span>
              <span className="tabular font-semibold">{peso(i.balance)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** What was collected today, by payment method (the daily report; needs billing.report.read). */
export function CollectedToday({ report }: { report: DailyBillingReport }) {
  return (
    <Panel title="Collected today" href="/billing/reports" linkLabel="Daily report">
      {report.collections.length === 0 ? (
        <EmptyState compact icon={ReceiptIcon} title="No payments yet today" />
      ) : (
        <dl className="divide-y text-table">
          {report.collections.map((c) => (
            <div key={c.method} className="flex items-center justify-between px-4 py-2.5">
              <dt>
                {METHOD_LABEL[c.method]} <span className="text-muted-foreground">· {c.count}</span>
              </dt>
              <dd className="tabular font-medium">{peso(c.amount)}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 font-semibold">
            <dt>Total collected</dt>
            <dd className="tabular">{peso(report.collectedTotal)}</dd>
          </div>
        </dl>
      )}
    </Panel>
  );
}

/** The queue in five lanes: a glance for the desk; the board itself is at /queue. */
export function QueueNow({ lanes, href }: { lanes: { key: string; label: string; count: number }[]; href?: string }) {
  return (
    <Panel title="Queue now" href={href} linkLabel="Open queue">
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
        {lanes.map((l) => (
          <div
            key={l.key}
            className={`rounded-lg border px-3 py-2 ${l.key === "waiting" && l.count > 0 ? "border-warning/40 bg-warning-subtle" : "bg-muted/40"}`}
          >
            <p className="tabular text-page font-semibold">{l.count}</p>
            <p className="text-table text-muted-foreground">{l.label}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
