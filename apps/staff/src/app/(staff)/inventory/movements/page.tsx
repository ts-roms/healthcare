import { redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { InventoryMovement } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { InventoryNav } from "../inventory-nav";

export const metadata = { title: "Stock movements" };

const KIND: Record<InventoryMovement["kind"], string> = {
  receipt: "Received",
  issue: "Issued",
  transfer_out: "Transferred out",
  transfer_in: "Transferred in",
  adjustment: "Count adjustment",
  write_off: "Written off",
  return: "Returned",
};

const SOURCE: Record<NonNullable<InventoryMovement["sourceType"]>, string> = {
  prescription_dispense: "Pharmacy dispense",
  lab_reagent_load: "Loaded on a laboratory instrument",
  purchase_order_line: "Purchase order delivery",
};

/** The ledger: every movement at this facility's locations, newest first (append-only). */
export default async function MovementsPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.read")) redirect("/");
  const nav = <InventoryNav canConfigure={can(session, "inventory.catalog.manage")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Stock movements" actions={nav} />
        <FacilityRequired action="Stock is kept per facility." />
      </>
    );
  }
  const movements = await api<InventoryMovement[]>("/inventory/movements");
  return (
    <>
      <PageHeader title="Stock movements" description={`${facility.name} · the latest 200 movements`} actions={nav} />
      <div className="p-4">
        <Card className="py-0">
          {movements.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">No movements yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{clinicalDateTime(m.recordedAt)}</TableCell>
                    <TableCell>{KIND[m.kind]}</TableCell>
                    <TableCell>{m.itemName}</TableCell>
                    <TableCell>{m.locationName}</TableCell>
                    <TableCell className="font-mono text-meta">{m.lotNumber ?? "—"}</TableCell>
                    <TableCell className={`text-right tabular-nums ${m.quantity < 0 ? "text-danger-foreground" : ""}`}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity} <span className="text-meta text-muted-foreground">{m.stockUnit}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.balanceAfter}</TableCell>
                    <TableCell className="max-w-sm text-meta">
                      {[
                        m.issuedTo && `To ${m.issuedTo}`,
                        m.reference && `Ref. ${m.reference}`,
                        m.reason,
                        m.unitCost !== null ? `${peso(m.unitCost)} each` : null,
                        m.sourceType ? SOURCE[m.sourceType] : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
