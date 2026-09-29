import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { SupplierInvoice } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { InventoryNav } from "../inventory-nav";
import { SupplierInvoiceStatusBadge } from "./status-badge";

export const metadata = { title: "Supplier invoices" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
  { key: "all", label: "All" },
] as const;

/** Supplier invoices recorded against the facility's purchase orders. */
export default async function SupplierInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.read")) redirect("/");
  const nav = <InventoryNav canConfigure={can(session, "inventory.catalog.manage")} canValue={can(session, "inventory.valuation.read")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Supplier invoices" actions={nav} />
        <FacilityRequired action="Supplier invoices are kept per facility." />
      </>
    );
  }
  const filter = FILTERS.find((f) => f.key === params.status)?.key ?? "open";
  const invoices = await api<SupplierInvoice[]>("/inventory/supplier-invoices", { query: { status: filter === "all" ? undefined : filter } });
  const day = (d: string) => clinicalDate(`${d}T12:00:00Z`);
  return (
    <>
      <PageHeader
        title="Supplier invoices"
        description={`${facility.name} · recorded against purchase orders and matched with what was received. Record an invoice from its purchase order.`}
        actions={nav}
      />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="Filter" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} asChild size="sm" variant={f.key === filter ? "secondary" : "ghost"}>
              <Link href={`/inventory/supplier-invoices?status=${f.key}`} aria-current={f.key === filter ? "true" : undefined}>
                {f.label}
              </Link>
            </Button>
          ))}
        </nav>
        {invoices.length === 0 ? (
          <p className="text-body text-muted-foreground">No supplier invoices here.</p>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Purchase order</TableHead>
                  <TableHead>Dated</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link href={`/inventory/supplier-invoices/${i.id}`} className="font-medium text-primary hover:underline">
                        {i.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{i.supplier?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Link href={`/inventory/purchase-orders/${i.purchaseOrderId}`} className="hover:underline">
                        {i.poNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{day(i.invoiceDate)}</TableCell>
                    <TableCell>{i.dueDate ? day(i.dueDate) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(i.total)}</TableCell>
                    <TableCell>
                      <SupplierInvoiceStatusBadge invoice={i} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
