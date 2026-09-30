import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, DateInput, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { InvoiceBadge } from "@/components/invoice-badge";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { InvoiceSummary } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { todayIn } from "@/lib/clinic-mapping";
import { BillingNav } from "../billing-nav";

export const metadata = { title: "Invoices" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "unpaid", label: "Balance owed" },
  { key: "issued", label: "Issued" },
  { key: "void", label: "Void" },
] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ show?: string; date?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "billing.charge.read")) redirect("/");
  const nav = <BillingNav canReport={can(session, "billing.report.read")} canConfigure={can(session, "billing.pricelist.manage")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Invoices" actions={nav} />
        <FacilityRequired action="Invoices are kept per facility." />
      </>
    );
  }
  const show = FILTERS.some((f) => f.key === params.show) ? (params.show as (typeof FILTERS)[number]["key"]) : "all";
  const date = params.date && DATE.test(params.date) ? params.date : show === "all" ? todayIn(facility.timezone) : undefined;
  const invoices = await api<InvoiceSummary[]>("/billing/invoices", {
    query: {
      status: show === "draft" || show === "issued" || show === "void" ? show : undefined,
      unpaid: show === "unpaid" ? "true" : undefined,
      date,
    },
  });
  const href = (key: string) => `/billing/invoices?show=${key}${date && key === "all" ? `&date=${date}` : ""}`;
  return (
    <>
      <PageHeader title="Invoices" description={`${facility.name}${date ? ` · ${date}` : ""}`} actions={nav} />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="Filter" className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} asChild size="sm" variant={f.key === show ? "default" : "outline"}>
              <Link href={href(f.key)} aria-current={f.key === show ? "page" : undefined}>
                {f.label}
              </Link>
            </Button>
          ))}
          <form className="ml-auto flex items-center gap-1" action="/billing/invoices">
            <input type="hidden" name="show" value="all" />
            <DateInput name="date" defaultValue={date} aria-label="Date" className="w-auto" />
            <Button type="submit" size="sm" variant="outline">
              Show day
            </Button>
          </form>
        </nav>
        <Card className="py-0">
          {invoices.length === 0 ? <p className="p-4 text-body text-muted-foreground">No invoices.</p> : null}
          {invoices.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Payers</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link href={`/billing/invoices/${inv.id}`} className="font-medium text-primary hover:underline">
                        {inv.invoiceNumber ?? "Draft"}
                      </Link>
                      <span className="block text-meta text-muted-foreground">{clinicalDateTime(inv.issuedAt ?? inv.createdAt)}</span>
                    </TableCell>
                    <TableCell>
                      {inv.patient?.displayName ?? "Patient"}
                      {inv.patient ? <span className="block font-mono text-meta text-muted-foreground">{inv.patient.patientNumber}</span> : null}
                    </TableCell>
                    <TableCell>
                      <InvoiceBadge invoice={inv} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{peso(inv.netTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inv.payerTotal ? peso(inv.payerTotal) : "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{inv.status === "issued" ? peso(inv.balance) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </Card>
      </div>
    </>
  );
}
