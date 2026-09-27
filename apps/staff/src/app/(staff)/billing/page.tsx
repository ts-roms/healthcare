import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { InvoiceBadge } from "@/components/invoice-badge";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { BillingWorklistRow, InvoiceSummary } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { BillingNav } from "./billing-nav";

export const metadata = { title: "Billing" };

/** The cashier's desk: patients with charges to invoice, drafts in progress, and invoices still owed. */
export default async function BillingPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "billing.charge.read")) redirect("/");
  const nav = <BillingNav canReport={can(session, "billing.report.read")} canConfigure={can(session, "billing.pricelist.manage")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Billing" actions={nav} />
        <FacilityRequired action="Charges, invoices and payments are kept per facility." />
      </>
    );
  }
  const [worklist, drafts, unpaid] = await Promise.all([
    api<BillingWorklistRow[]>("/billing/worklist"),
    api<InvoiceSummary[]>("/billing/invoices", { query: { status: "draft" } }),
    api<InvoiceSummary[]>("/billing/invoices", { query: { unpaid: "true" } }),
  ]);
  return (
    <>
      <PageHeader title="Billing" description={`${facility.name} · charges to invoice, drafts and balances`} actions={nav} />
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <Card className="py-0 xl:col-span-2">
          <CardHeader className="pt-4">
            <CardTitle>To invoice</CardTitle>
            <span className="ml-auto text-meta text-muted-foreground">Charges captured from consultations, laboratory orders and staff</span>
          </CardHeader>
          <CardContent className="px-0">
            {worklist.length === 0 ? (
              <p className="px-4 pb-4 text-body text-muted-foreground">No charges waiting to be invoiced.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead className="text-right">Charges</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Since</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {worklist.map((row) => (
                    <TableRow key={row.patientId}>
                      <TableCell>
                        <Link href={`/billing/patients/${row.patientId}`} className="font-medium text-primary hover:underline">
                          {row.patient?.displayName ?? "Patient"}
                        </Link>
                        {row.patient ? <span className="block font-mono text-meta text-muted-foreground">{row.patient.patientNumber}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{peso(row.amount)}</TableCell>
                      <TableCell>{clinicalDate(row.oldest)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <InvoiceList title="Drafts in progress" empty="No drafts." invoices={drafts} />
        <InvoiceList title="Balances owed" empty="Nothing owed on issued invoices." invoices={unpaid} />
      </div>
    </>
  );
}

function InvoiceList({ title, empty, invoices }: { title: string; empty: string; invoices: InvoiceSummary[] }) {
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {invoices.length === 0 ? <p className="px-4 pb-4 text-body text-muted-foreground">{empty}</p> : null}
        <ul className="divide-y">
          {invoices.map((inv) => (
            <li key={inv.id}>
              <Link href={`/billing/invoices/${inv.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-accent">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{inv.patient?.displayName ?? "Patient"}</span>
                  <span className="block text-meta text-muted-foreground">
                    {inv.invoiceNumber ?? "Draft"} · {clinicalDateTime(inv.issuedAt ?? inv.createdAt)}
                  </span>
                </span>
                <InvoiceBadge invoice={inv} />
                <span className="w-24 text-right font-medium tabular-nums">{peso(inv.status === "issued" ? inv.balance : inv.patientTotal)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
