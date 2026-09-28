"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { InventoryItem, InventoryLocation, InventorySupplier, ReorderSuggestion } from "@/lib/api/types";
import { parsePesos, pesoInput } from "@/lib/billing-mapping";
import { linesFromSuggestions } from "@/lib/inventory-mapping";
import { createPurchaseOrder } from "../actions";

interface Line {
  key: string;
  itemId: string;
  quantity: string;
  unitCost: string;
}

const newLine = (patch: Partial<Line> = {}): Line => ({ key: crypto.randomUUID(), itemId: "", quantity: "", unitCost: "", ...patch });

/** Drafts a purchase order (a draft can still be cancelled; submitting sends it for approval). */
export function NewPurchaseOrder({
  items,
  suppliers,
  locations,
  suggestions,
}: {
  items: InventoryItem[];
  suppliers: InventorySupplier[];
  locations: InventoryLocation[];
  suggestions: ReorderSuggestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [f, setF] = React.useState({ supplierId: "", locationId: locations[0]?.id ?? "", expectedDate: "", notes: "" });
  const [lines, setLines] = React.useState<Line[]>([newLine()]);
  const suggested = linesFromSuggestions(suggestions, f.locationId);
  const setLine = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const fillFromSuggestions = () =>
    setLines(suggested.map((s) => newLine({ itemId: s.itemId, quantity: String(s.quantity), unitCost: s.unitCost === null ? "" : pesoInput(s.unitCost) })));

  const submit = () =>
    startTransition(async () => {
      const filled = lines.filter((l) => l.itemId);
      const badCost = filled.find((l) => l.unitCost && parsePesos(l.unitCost) === null);
      if (badCost) {
        toast.error("Enter unit costs in pesos, e.g. 12.50.");
        return;
      }
      const result = await createPurchaseOrder({
        supplierId: f.supplierId,
        locationId: f.locationId,
        expectedDate: f.expectedDate || undefined,
        notes: f.notes || undefined,
        lines: filled.map((l) => ({ itemId: l.itemId, quantity: Number.parseInt(l.quantity, 10), unitCost: l.unitCost ? parsePesos(l.unitCost) : null })),
      });
      if (result.ok) {
        toast.success("Purchase order drafted");
        router.push(`/inventory/purchase-orders/${result.data.id}`);
      } else toast.error(result.message);
    });

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>New purchase order</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Field id="po-supplier" label="Supplier">
              <NativeSelect id="po-supplier" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                <option value="">Choose…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="po-location" label="Deliver to">
              <NativeSelect id="po-location" value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="po-expected" label="Expected by (optional)">
              <Input id="po-expected" type="date" value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-label mb-1 font-medium">Items (quantities in stock units; unit cost in pesos, optional)</legend>
            {lines.map((line, index) => {
              const item = items.find((i) => i.id === line.itemId);
              return (
                <div key={line.key} className="grid grid-cols-[1fr_5rem_6rem_auto] items-end gap-2">
                  <Field id={`po-item-${index}`} label={`Item ${index + 1}`}>
                    <NativeSelect id={`po-item-${index}`} value={line.itemId} onChange={(e) => setLine(line.key, { itemId: e.target.value })}>
                      <option value="">Choose…</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id={`po-qty-${index}`} label={item ? `Qty (${item.stockUnit})` : "Qty"}>
                    <Input
                      id={`po-qty-${index}`}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(e) => setLine(line.key, { quantity: e.target.value.replace(/\D/g, "") })}
                    />
                  </Field>
                  <Field id={`po-cost-${index}`} label="Unit cost">
                    <Input
                      id={`po-cost-${index}`}
                      inputMode="decimal"
                      value={line.unitCost}
                      onChange={(e) => setLine(line.key, { unitCost: e.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove item ${index + 1}`}
                    disabled={lines.length === 1}
                    onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, newLine()])}>
                <PlusIcon /> Add item
              </Button>
              {suggested.length > 0 ? (
                <Button type="button" variant="outline" size="sm" onClick={fillFromSuggestions}>
                  <WandSparklesIcon /> Fill from reorder list ({suggested.length})
                </Button>
              ) : null}
            </div>
          </fieldset>
          <Field id="po-notes" label="Notes (optional)">
            <Textarea id="po-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <Button type="submit" disabled={pending || !f.supplierId || !f.locationId || !lines.some((l) => l.itemId && l.quantity)}>
            Save draft
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
