"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, DateInput, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { InventoryItem, InventoryLocation, InventorySupplier, StockRow } from "@/lib/api/types";
import { parsePesos } from "@/lib/billing-mapping";
import { adjustStock, issueStock, receiveStock, transferStock, writeOffStock } from "./actions";

type Kind = "receive" | "issue" | "transfer" | "adjust" | "write_off";
const KINDS: Array<{ key: Kind; label: string; adjust?: boolean }> = [
  { key: "receive", label: "Receive" },
  { key: "issue", label: "Issue" },
  { key: "transfer", label: "Transfer" },
  { key: "adjust", label: "Count", adjust: true },
  { key: "write_off", label: "Write off", adjust: true },
];

const empty = {
  itemId: "",
  locationId: "",
  toLocationId: "",
  lotId: "",
  lotNumber: "",
  expiryDate: "",
  quantity: "",
  supplierId: "",
  unitCost: "",
  issuedTo: "",
  reference: "",
  reason: "",
};

/**
 * Records one stock movement. The API decides what is allowed (facility, stock on hand, expired lots, controlled
 * items); issues and transfers take lots first-expiry-first-out unless one is chosen.
 */
export function MovementForm({
  items,
  locations,
  allLocations,
  suppliers,
  stock,
  canMove,
  canAdjust,
}: {
  items: InventoryItem[];
  locations: InventoryLocation[];
  allLocations: InventoryLocation[];
  suppliers: InventorySupplier[];
  stock: StockRow[];
  canMove: boolean;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const kinds = KINDS.filter((k) => (k.adjust ? canAdjust : canMove));
  const [kind, setKind] = React.useState<Kind>(kinds[0]?.key ?? "receive");
  const [f, setF] = React.useState({ ...empty, locationId: locations[0]?.id ?? "" });
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [pending, startTransition] = React.useTransition();
  const item = items.find((i) => i.id === f.itemId);
  const lots = stock.find((r) => r.item.id === f.itemId && r.location.id === f.locationId)?.lots ?? [];
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const qty = Number.parseInt(f.quantity, 10);

  const submit = () =>
    startTransition(async () => {
      const common = { reference: f.reference || undefined, reason: f.reason || undefined, idempotencyKey: key };
      const result =
        kind === "receive"
          ? await receiveStock({
              locationId: f.locationId,
              itemId: f.itemId,
              lotNumber: f.lotNumber || undefined,
              expiryDate: f.expiryDate || undefined,
              quantity: qty,
              supplierId: f.supplierId || undefined,
              unitCost: f.unitCost ? (parsePesos(f.unitCost) ?? undefined) : undefined,
              ...common,
            })
          : kind === "issue"
            ? await issueStock({ locationId: f.locationId, itemId: f.itemId, lotId: f.lotId || undefined, quantity: qty, issuedTo: f.issuedTo, ...common })
            : kind === "transfer"
              ? await transferStock({
                  fromLocationId: f.locationId,
                  toLocationId: f.toLocationId,
                  itemId: f.itemId,
                  lotId: f.lotId || undefined,
                  quantity: qty,
                  ...common,
                })
              : kind === "adjust"
                ? await adjustStock({
                    locationId: f.locationId,
                    lotId: f.lotId,
                    countedQuantity: Number.isNaN(qty) ? -1 : qty,
                    reason: f.reason,
                    reference: f.reference || undefined,
                    idempotencyKey: key,
                  })
                : await writeOffStock({
                    locationId: f.locationId,
                    lotId: f.lotId,
                    quantity: qty,
                    reason: f.reason,
                    reference: f.reference || undefined,
                    idempotencyKey: key,
                  });
      if (result.ok) {
        toast.success("Recorded");
        setF({ ...empty, locationId: f.locationId });
        setKey(crypto.randomUUID());
        router.refresh();
      } else toast.error(result.message);
    });

  const needsLot = kind === "adjust" || kind === "write_off";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a movement</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-body">
        <div role="tablist" aria-label="Movement" className="flex flex-wrap gap-1">
          {kinds.map((k) => (
            <Button
              key={k.key}
              role="tab"
              aria-selected={kind === k.key}
              size="xs"
              variant={kind === k.key ? "default" : "outline"}
              onClick={() => setKind(k.key)}
            >
              {k.label}
            </Button>
          ))}
        </div>
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={kind === "transfer" ? "From" : "Location"} id="mv-location">
            <NativeSelect id="mv-location" value={f.locationId} onChange={(e) => set({ locationId: e.target.value, lotId: "" })}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {kind === "transfer" ? (
            <Field label="To" id="mv-to">
              <NativeSelect placeholder="Choose…" id="mv-to" value={f.toLocationId} onChange={(e) => set({ toLocationId: e.target.value })}>
                {allLocations
                  .filter((l) => l.id !== f.locationId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field label="Item" id="mv-item" wide={kind !== "transfer"}>
            <NativeSelect placeholder="Choose…" id="mv-item" value={f.itemId} onChange={(e) => set({ itemId: e.target.value, lotId: "" })}>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.stockUnit}){i.controlled ? " — controlled" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {kind === "receive" && item?.tracksLots ? (
            <>
              <Field label="Lot number" id="mv-lot-number">
                <Input id="mv-lot-number" value={f.lotNumber} maxLength={60} onChange={(e) => set({ lotNumber: e.target.value })} />
              </Field>
              <Field label="Expiry" id="mv-expiry">
                <DateInput id="mv-expiry" value={f.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} />
              </Field>
            </>
          ) : null}
          {kind !== "receive" ? (
            <Field label={needsLot ? "Lot" : "Lot (optional: earliest expiry first)"} id="mv-lot" wide>
              <NativeSelect id="mv-lot" value={f.lotId} onChange={(e) => set({ lotId: e.target.value })}>
                <option value="">{needsLot ? "Choose…" : "Earliest expiry first"}</option>
                {lots.map((l) => (
                  <option key={l.lotId} value={l.lotId}>
                    {l.lotNumber ?? "—"} × {l.quantity}
                    {l.expiryDate ? ` · exp. ${l.expiryDate}` : ""}
                    {l.expiry === "expired" ? " (expired)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field label={kind === "adjust" ? "Counted quantity" : "Quantity"} id="mv-qty">
            <Input id="mv-qty" inputMode="numeric" value={f.quantity} onChange={(e) => set({ quantity: e.target.value.replace(/\D/g, "") })} />
          </Field>
          {kind === "receive" ? (
            <>
              <Field label="Supplier" id="mv-supplier">
                <NativeSelect id="mv-supplier" value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Unit cost (₱, optional)" id="mv-cost">
                <Input id="mv-cost" inputMode="decimal" value={f.unitCost} onChange={(e) => set({ unitCost: e.target.value })} />
              </Field>
            </>
          ) : null}
          {kind === "issue" ? (
            <Field label="Issued to (department or purpose)" id="mv-issued-to" wide>
              <Input id="mv-issued-to" value={f.issuedTo} maxLength={120} onChange={(e) => set({ issuedTo: e.target.value })} />
            </Field>
          ) : null}
          <Field label={`Reference${item?.controlled ? "" : " (optional)"}`} id="mv-reference">
            <Input id="mv-reference" value={f.reference} maxLength={80} onChange={(e) => set({ reference: e.target.value })} />
          </Field>
          <Field label={`Reason${needsLot || item?.controlled ? "" : " (optional)"}`} id="mv-reason">
            <Input id="mv-reason" value={f.reason} maxLength={500} onChange={(e) => set({ reason: e.target.value })} />
          </Field>
          <Button type="submit" size="sm" className="justify-self-start sm:col-span-2" disabled={pending || !f.itemId || !f.locationId || !f.quantity}>
            Record
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, id, wide, children }: { label: string; id: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
