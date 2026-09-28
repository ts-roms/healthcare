import { redirect } from "next/navigation";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Card, CardContent, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { PurchaseOrder } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { purchaseOrderActions } from "@/lib/inventory-mapping";
import { InventoryNav } from "../../inventory-nav";
import { PurchaseOrderStatusBadge } from "../status-badge";
import { PurchaseOrderActions } from "./purchase-order-actions";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.read")) redirect("/");
  const nav = <InventoryNav canConfigure={can(session, "inventory.catalog.manage")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Purchase order" actions={nav} />
        <FacilityRequired action="Purchase orders are placed per facility." />
      </>
    );
  }
  const order = await api<PurchaseOrder>(`/inventory/purchase-orders/${id}`);
  const actions = purchaseOrderActions(order, session.permissions);
  const history = [
    { label: "Drafted", at: order.createdAt },
    { label: "Submitted for approval", at: order.submittedAt },
    { label: "Approved", at: order.approvedAt },
    { label: order.status === "cancelled" ? "Cancelled" : "Closed short", at: order.endedAt, note: order.endReason },
  ].filter((h) => h.at);
  return (
    <>
      <PageHeader
        title={`Purchase order ${order.poNumber}`}
        description={`${order.supplier?.name ?? "—"} · deliver to ${order.location?.name ?? "—"}${order.expectedDate ? ` · expected ${clinicalDate(order.expectedDate)}` : ""}`}
        actions={nav}
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PurchaseOrderStatusBadge status={order.status} />
            {order.status === "submitted" && order.submittedByYou ? (
              <span className="text-meta text-muted-foreground">You submitted this order; someone else approves it.</span>
            ) : null}
          </div>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums">{l.lineNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium">{l.item.name}</div>
                      <div className="text-meta text-muted-foreground">
                        {l.item.code}
                        {l.item.controlled ? " · controlled" : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.quantityOrdered} <span className="text-meta text-muted-foreground">{l.item.stockUnit}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.quantityReceived}
                      {l.outstanding > 0 && l.quantityReceived > 0 ? <div className="text-meta text-muted-foreground">{l.outstanding} to come</div> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.unitCost === null ? "—" : peso(l.unitCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.unitCost === null ? "—" : peso(l.unitCost * l.quantityOrdered)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-medium">
                    Total{order.unpricedLines ? ` (${order.unpricedLines} line${order.unpricedLines === 1 ? "" : "s"} without a price)` : ""}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{peso(order.totalCost)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
          {order.notes ? <p className="text-body whitespace-pre-line">{order.notes}</p> : null}
          <Card>
            <CardContent>
              <ol className="flex flex-col gap-1 text-body">
                {history.map((h) => (
                  <li key={h.label}>
                    <span className="font-medium">{h.label}</span> <span className="text-muted-foreground">{clinicalDateTime(h.at!)}</span>
                    {h.note ? <span className="text-muted-foreground"> · {h.note}</span> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        {actions.length > 0 ? <PurchaseOrderActions order={order} actions={actions} /> : null}
      </div>
    </>
  );
}
