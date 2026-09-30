import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Card, CardContent, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { SupplierInvoiceDetail, WithholdingCode } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { quantityWithUnit, supplierInvoiceActions } from "@/lib/inventory-mapping";
import { InventoryNav } from "../../inventory-nav";
import { SupplierInvoiceStatusBadge } from "../status-badge";
import { SupplierInvoiceActions } from "./invoice-actions";

export const metadata = { title: "Supplier invoice" };

const day = (d: string) => clinicalDate(`${d}T12:00:00Z`);

export default async function SupplierInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.read")) redirect("/");
  const nav = (
    <InventoryNav
      canConfigure={can(session, "inventory.catalog.manage")}
      canValue={can(session, "inventory.valuation.read")}
      canRegister={can(session, "inventory.controlled-register.read")}
    />
  );
  if (!facility) {
    return (
      <>
        <PageHeader title="Supplier invoice" actions={nav} />
        <FacilityRequired action="Supplier invoices are kept per facility." />
      </>
    );
  }
  const [invoice, withholdingCodes] = await Promise.all([
    api<SupplierInvoiceDetail>(`/inventory/supplier-invoices/${id}`),
    api<WithholdingCode[]>("/inventory/withholding-codes"),
  ]);
  const actions = supplierInvoiceActions(invoice, session.permissions);
  const variances = invoice.lines.filter((l) => l.variance !== null && l.variance !== 0).length;
  const history = [
    { label: "Recorded", at: invoice.recordedAt, note: invoice.recordedByYou ? "by you" : null },
    { label: "Approved for payment", at: invoice.approvedAt, note: invoice.approvalNote },
    { label: "Paid", at: invoice.paidOn ? `${invoice.paidOn}T12:00:00Z` : null, note: invoice.paymentReference, dateOnly: true },
    { label: "Voided", at: invoice.voidedAt, note: invoice.voidReason },
  ].filter((h) => h.at);
  return (
    <>
      <PageHeader
        title={`Supplier invoice ${invoice.invoiceNumber}`}
        description={`${invoice.supplier?.name ?? "—"} · dated ${day(invoice.invoiceDate)}${invoice.dueDate ? ` · due ${day(invoice.dueDate)}` : ""}`}
        actions={nav}
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SupplierInvoiceStatusBadge invoice={invoice} />
            <span className="text-meta text-muted-foreground">
              Against{" "}
              <Link href={`/inventory/purchase-orders/${invoice.purchaseOrderId}`} className="text-primary hover:underline">
                {invoice.poNumber}
              </Link>
            </span>
            {invoice.status === "recorded" && invoice.recordedByYou ? (
              <span className="text-meta text-muted-foreground">You recorded this invoice; someone else approves it.</span>
            ) : null}
          </div>
          {variances ? (
            <p className="flex items-center gap-2 text-table text-warning-foreground">
              <TriangleAlertIcon aria-hidden className="size-4" />
              {variances === 1 ? "One line is" : `${variances} lines are`} invoiced at a price different from the purchase order.
              {invoice.status === "recorded" ? " Approval needs a note." : ""}
            </p>
          ) : null}
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Ordered / received</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Order price</TableHead>
                  <TableHead className="text-right">Invoiced price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums">{l.lineNumber}</TableCell>
                    <TableCell className="font-medium">{l.itemName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.quantityOrdered} / {l.quantityReceived}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{quantityWithUnit(l.quantity, l.stockUnit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.orderUnitCost === null ? "—" : peso(l.orderUnitCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {peso(l.unitPrice)}
                      {l.variance ? (
                        <span className="block text-meta text-warning-foreground">
                          {l.variance > 0 ? "▲" : "▼"} {peso(Math.abs(l.variance))} vs order
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{peso(l.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={6} className="text-right">
                    Lines
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{peso(invoice.linesTotal)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={6} className="text-right">
                    VAT as stated on the invoice
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{peso(invoice.vatAmount)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={6} className="text-right font-medium">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{peso(invoice.total)}</TableCell>
                </TableRow>
                {invoice.withholdingCode ? (
                  <>
                    <TableRow>
                      <TableCell colSpan={6} className="text-right">
                        Withheld ({invoice.withholdingCode.code}
                        {invoice.withholdingReference ? `, certificate ${invoice.withholdingReference}` : ""})
                      </TableCell>
                      <TableCell className="text-right tabular-nums">−{peso(invoice.withheldAmount)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} className="text-right font-medium">
                        Paid to the supplier
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{peso(invoice.netPaid ?? invoice.total)}</TableCell>
                    </TableRow>
                  </>
                ) : null}
              </TableBody>
            </Table>
          </Card>
          {invoice.notes ? <p className="text-body whitespace-pre-line">{invoice.notes}</p> : null}
          <Card>
            <CardContent>
              <ol className="flex flex-col gap-1 text-body">
                {history.map((h) => (
                  <li key={h.label}>
                    <span className="font-medium">{h.label}</span>{" "}
                    <span className="text-muted-foreground">{h.dateOnly ? clinicalDate(h.at!) : clinicalDateTime(h.at!)}</span>
                    {h.note ? <span className="text-muted-foreground"> · {h.note}</span> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        {actions.length ? (
          <SupplierInvoiceActions
            invoice={invoice}
            actions={actions}
            needsNote={variances > 0}
            withholdingCodes={withholdingCodes.filter((c) => c.status === "active")}
          />
        ) : null}
      </div>
    </>
  );
}
