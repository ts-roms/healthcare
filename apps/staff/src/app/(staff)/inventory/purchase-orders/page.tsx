import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { InventoryItem, InventoryLocation, InventorySupplier, PurchaseOrder, ReorderSuggestion } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { InventoryNav } from "../inventory-nav";
import { NewPurchaseOrder } from "./new-purchase-order";
import { PurchaseOrderStatusBadge } from "./status-badge";

export const metadata = { title: "Purchase orders" };

/** Purchase orders of the selected facility, reorder suggestions, and a new order (drafted by buyers). */
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.read")) redirect("/");
  const nav = <InventoryNav canConfigure={can(session, "inventory.catalog.manage")} canValue={can(session, "inventory.valuation.read")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Purchase orders" actions={nav} />
        <FacilityRequired action="Purchase orders are placed per facility." />
      </>
    );
  }
  const show = params.show === "all" ? "all" : "open";
  const canManage = can(session, "inventory.procurement.manage");
  const [orders, suggestions, items, suppliers, locations] = await Promise.all([
    api<PurchaseOrder[]>("/inventory/purchase-orders", { query: show === "open" ? { status: "open" } : {} }),
    api<ReorderSuggestion[]>("/inventory/reorder-suggestions"),
    canManage ? api<InventoryItem[]>("/inventory/items") : Promise.resolve([]),
    canManage ? api<InventorySupplier[]>("/inventory/suppliers") : Promise.resolve([]),
    canManage ? api<InventoryLocation[]>("/inventory/locations", { query: { scope: "facility" } }) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description={`${facility.name} · ordered from suppliers, approved by someone else, received into stock`}
        actions={nav}
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <nav aria-label="Filter" className="flex gap-1">
            {(["open", "all"] as const).map((key) => (
              <Button key={key} asChild size="sm" variant={key === show ? "default" : "outline"}>
                <Link href={`/inventory/purchase-orders?show=${key}`} aria-current={key === show ? "page" : undefined}>
                  {key === "open" ? "Open" : "All"}
                </Link>
              </Button>
            ))}
          </nav>
          <Card className="py-0">
            {orders.length === 0 ? (
              <p className="p-4 text-body text-muted-foreground">{show === "open" ? "No open purchase orders." : "No purchase orders yet."}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Deliver to</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/inventory/purchase-orders/${o.id}`} className="font-mono font-medium underline-offset-2 hover:underline">
                          {o.poNumber}
                        </Link>
                        <div className="text-meta text-muted-foreground">
                          {clinicalDate(o.createdAt)}
                          {o.expectedDate ? ` · expected ${clinicalDate(o.expectedDate)}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>{o.supplier?.name ?? "—"}</TableCell>
                      <TableCell>{o.location?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.lines.length}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {peso(o.totalCost)}
                        {o.unpricedLines ? <div className="text-meta text-muted-foreground">{o.unpricedLines} unpriced</div> : null}
                      </TableCell>
                      <TableCell>
                        <PurchaseOrderStatusBadge status={o.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>To reorder</CardTitle>
            </CardHeader>
            <CardContent className="text-body">
              {suggestions.length === 0 ? (
                <p className="text-muted-foreground">Nothing is at or below its reorder level (stock on open orders counts).</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {suggestions.map((s) => (
                    <li key={`${s.location.id}-${s.item.id}`} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{s.item.name}</span>
                      <span className="text-muted-foreground">
                        {s.location.name} · {s.usable} {s.item.stockUnit} usable
                        {s.onOrder ? `, ${s.onOrder} on order` : ""} · reorder at {s.reorderLevel}
                        {s.suggestedQuantity ? ` · usually order ${s.suggestedQuantity}` : ""}
                        {s.lastSupplier ? ` · last from ${s.lastSupplier.name}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        {canManage ? (
          <NewPurchaseOrder
            items={items.filter((i) => i.status === "active")}
            suppliers={suppliers.filter((s) => s.status === "active")}
            locations={locations.filter((l) => l.status === "active")}
            suggestions={suggestions}
          />
        ) : null}
      </div>
    </>
  );
}
