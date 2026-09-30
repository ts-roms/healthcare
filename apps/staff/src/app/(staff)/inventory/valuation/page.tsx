import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { clinicalDate } from "@healthcare/ui/healthcare";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { InventoryUsage, InventoryValuation } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { shiftDate, todayIn } from "@/lib/clinic-mapping";
import { INVENTORY_CATEGORY_LABEL, quantityWithUnit, usageLabel } from "@/lib/inventory-mapping";
import { InventoryNav } from "../inventory-nav";

export const metadata = { title: "Inventory valuation" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (date: string) => clinicalDate(`${date}T12:00:00Z`);

/** Stock at cost and what was received, used and written off in a period (lot cost = weighted average of its priced receipts). */
export default async function ValuationPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.valuation.read")) redirect("/inventory");
  const nav = (
    <InventoryNav canConfigure={can(session, "inventory.catalog.manage")} canValue canRegister={can(session, "inventory.controlled-register.read")} />
  );
  if (!facility) {
    return (
      <>
        <PageHeader title="Inventory valuation" actions={nav} />
        <FacilityRequired action="Stock is valued per facility." />
      </>
    );
  }
  const today = todayIn(facility.timezone);
  const to = params.to && DATE.test(params.to) ? params.to : today;
  const from = params.from && DATE.test(params.from) && params.from <= to ? params.from : shiftDate(to, -29);
  const [value, usage] = await Promise.all([
    api<InventoryValuation>("/inventory/valuation"),
    api<InventoryUsage>("/inventory/valuation/usage", { query: { from, to } }),
  ]);
  const received = usage.rows.filter((r) => r.kind === "receipt");
  const used = usage.rows.filter((r) => r.kind !== "receipt");
  const usedValue = -used.reduce((n, r) => n + r.value, 0);
  const receivedValue = received.reduce((n, r) => n + r.value, 0);

  return (
    <>
      <PageHeader
        title="Inventory valuation"
        description={`${facility.name} · stock at cost (each lot at the average price of its receipts). Operational figures for stock control, not an accounting or BIR valuation.`}
        actions={nav}
      />
      <div className="flex flex-col gap-4 p-4">
        <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure label="Stock value" value={peso(value.totalValue)}>
            {value.lines.length} item–location lines
          </Figure>
          <Figure label="Unvalued stock" value={String(value.unvaluedLines)}>
            lines with a lot received without a cost
          </Figure>
          <Figure label="Received" value={peso(receivedValue)}>
            {day(from)} to {day(to)}
          </Figure>
          <Figure label="Used and written off" value={peso(usedValue)}>
            net of returns and count adjustments
          </Figure>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>By category</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleTable
                empty="No stock on hand."
                head={["Category", "Lines", "Value"]}
                rows={value.byCategory.map((c) => [INVENTORY_CATEGORY_LABEL[c.category], c.lines, peso(c.value)])}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By location</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleTable
                empty="No stock on hand."
                head={["Location", "Lines", "Value"]}
                rows={value.byLocation.map((l) => [l.name, l.lines, peso(l.value)])}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Stock at cost</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleTable
              empty="No stock on hand."
              head={["Item", "Location", "On hand", "Average cost", "Value"]}
              rows={value.lines.map((l) => [
                <span key="i">
                  {l.name} <span className="text-meta text-muted-foreground">· {INVENTORY_CATEGORY_LABEL[l.category]}</span>
                  {l.unvaluedQuantity > 0 ? (
                    <span className="block text-meta text-warning-foreground">
                      {quantityWithUnit(l.unvaluedQuantity, l.stockUnit)} without a cost (not counted)
                    </span>
                  ) : null}
                </span>,
                l.locationName,
                quantityWithUnit(l.quantity, l.stockUnit),
                l.averageUnitCost === null ? "—" : peso(l.averageUnitCost),
                peso(l.value),
              ])}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Received and used</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Period">
              <div className="grid gap-1">
                <Label htmlFor="usage-from">From</Label>
                <DateInput id="usage-from" name="from" defaultValue={from} className="w-40" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="usage-to">To</Label>
                <DateInput id="usage-to" name="to" defaultValue={to} className="w-40" />
              </div>
              <Button type="submit" size="sm">
                Apply
              </Button>
            </form>
            <SimpleTable
              empty="Nothing moved in this period."
              head={["Movement", "Movements", "Quantity", "Value"]}
              rows={usage.rows.map((r) => [
                <span key="l">
                  {usageLabel(r.kind, r.sourceType)}
                  {r.unvaluedQuantity > 0 ? <span className="block text-meta text-muted-foreground">{r.unvaluedQuantity} units without a cost</span> : null}
                </span>,
                r.movements,
                r.quantity.toLocaleString("en-PH"),
                peso(r.value),
              ])}
            />
            <SimpleTable
              empty="No stock used in this period."
              head={["Most used by value", "Quantity", "Value"]}
              rows={usage.topItems.map((t) => [t.name, quantityWithUnit(t.quantity, t.stockUnit), peso(t.value)])}
            />
            <p className="text-meta text-muted-foreground">
              Uses are valued at the lot cost recorded when each movement was posted; movements from before costs were recorded count as without a cost.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Figure({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <Card className="p-3">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="tabular text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-meta text-muted-foreground">{children}</p>
    </Card>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-table text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h, i) => (
            <TableHead key={h} className={i === 0 ? undefined : "text-right"}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, r) => (
          <TableRow key={r}>
            {row.map((cell, i) => (
              <TableCell key={i} className={i === 0 ? undefined : "tabular text-right"}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
