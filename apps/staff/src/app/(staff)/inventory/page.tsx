import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { InventoryItem, InventoryLocation, InventorySupplier, StockRow } from "@/lib/api/types";
import { InventoryNav } from "./inventory-nav";
import { MovementForm } from "./movement-form";
import { ExpiryStatus, StockStatus } from "./stock-status";

export const metadata = { title: "Inventory" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "low", label: "Low or out" },
  { key: "expiring", label: "Expiring (60 days)" },
] as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ show?: string; location?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.read")) redirect("/");
  const nav = <InventoryNav canConfigure={can(session, "inventory.catalog.manage")} canValue={can(session, "inventory.valuation.read")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Inventory" actions={nav} />
        <FacilityRequired action="Stock is kept per facility." />
      </>
    );
  }
  const show = FILTERS.find((f) => f.key === params.show)?.key ?? "all";
  const filtered = show !== "all" || Boolean(params.location);
  const [stock, unfiltered, locations, allLocations, items, suppliers] = await Promise.all([
    api<{ today: string; rows: StockRow[] }>("/inventory/stock", { query: { show, locationId: params.location } }),
    // The movement form picks lots from all stock, whatever the table is filtered to.
    filtered ? api<{ today: string; rows: StockRow[] }>("/inventory/stock", { query: { show: "all" } }) : null,
    api<InventoryLocation[]>("/inventory/locations", { query: { scope: "facility" } }),
    api<InventoryLocation[]>("/inventory/locations"),
    api<InventoryItem[]>("/inventory/items"),
    api<InventorySupplier[]>("/inventory/suppliers"),
  ]);
  const canMove = can(session, "inventory.move");
  const canAdjust = can(session, "inventory.adjust");
  const href = (key: string) => `/inventory?show=${key}${params.location ? `&location=${params.location}` : ""}`;
  return (
    <>
      <PageHeader title="Inventory" description={`${facility.name} · medicines, supplies and reagents by location, lot and expiry`} actions={nav} />
      <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <nav aria-label="Filter" className="flex flex-wrap items-center gap-1">
            {FILTERS.map((f) => (
              <Button key={f.key} asChild size="sm" variant={f.key === show ? "default" : "outline"}>
                <Link href={href(f.key)} aria-current={f.key === show ? "page" : undefined}>
                  {f.label}
                </Link>
              </Button>
            ))}
            <span className="ml-2 text-meta text-muted-foreground">Location:</span>
            <Button asChild size="sm" variant={!params.location ? "secondary" : "ghost"}>
              <Link href={`/inventory?show=${show}`}>All</Link>
            </Button>
            {locations.map((l) => (
              <Button key={l.id} asChild size="sm" variant={params.location === l.id ? "secondary" : "ghost"}>
                <Link href={`/inventory?show=${show}&location=${l.id}`}>{l.name}</Link>
              </Button>
            ))}
          </nav>
          <Card className="py-0">
            {stock.rows.length === 0 ? (
              <p className="p-4 text-body text-muted-foreground">
                {locations.length === 0 ? "No storage locations at this facility yet (see Catalog)." : "Nothing to show."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Usable</TableHead>
                    <TableHead className="text-right">Reorder at</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Lots (earliest expiry first)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stock.rows.map((r) => (
                    <TableRow key={`${r.location.id}-${r.item.id}`}>
                      <TableCell>
                        <div className="font-medium">{r.item.name}</div>
                        <div className="text-meta text-muted-foreground">
                          {r.item.code}
                          {r.item.controlled ? " · controlled" : ""}
                        </div>
                      </TableCell>
                      <TableCell>{r.location.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.usable} <span className="text-meta text-muted-foreground">{r.item.stockUnit}</span>
                        {r.onHand !== r.usable ? <div className="text-meta text-muted-foreground">{r.onHand - r.usable} expired</div> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.reorderLevel ?? "—"}</TableCell>
                      <TableCell>
                        <StockStatus status={r.status} />
                      </TableCell>
                      <TableCell>
                        <ul className="flex flex-col gap-0.5 text-meta">
                          {r.lots.map((l) => (
                            <li key={l.lotId} className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono">{l.lotNumber ?? "—"}</span>
                              <span className="tabular-nums">× {l.quantity}</span>
                              {l.expiryDate ? <span className="text-muted-foreground">exp. {clinicalDate(l.expiryDate)}</span> : null}
                              <ExpiryStatus expiry={l.expiry} />
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
        {canMove || canAdjust ? (
          <MovementForm
            items={items.filter((i) => i.status === "active")}
            locations={locations.filter((l) => l.status === "active")}
            allLocations={allLocations.filter((l) => l.status === "active")}
            suppliers={suppliers.filter((s) => s.status === "active")}
            stock={(unfiltered ?? stock).rows}
            canMove={canMove}
            canAdjust={canAdjust}
          />
        ) : null}
      </div>
    </>
  );
}
