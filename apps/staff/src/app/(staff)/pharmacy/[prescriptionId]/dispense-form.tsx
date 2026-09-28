"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { DispensableStock, PrescriptionLine } from "@/lib/api/types";
import { dispense, reverseDispense } from "../actions";

const stockKey = (s: Pick<DispensableStock, "locationId" | "itemId">) => `${s.locationId}|${s.itemId}`;

/** Stock that looks like the prescribed medicine first (a name match only: the pharmacist chooses). */
function ranked(stock: DispensableStock[], genericName: string): DispensableStock[] {
  const name = genericName.trim().toLowerCase();
  const matches = (s: DispensableStock) => s.itemName.toLowerCase().includes(name);
  return [...stock.filter(matches), ...stock.filter((s) => !matches(s))];
}

/**
 * Hands over prescribed items from stock at this facility. Quantities are in the chosen item's stock unit; the API
 * takes lots first-expiry-first-out (never expired) and refuses more than prescribed when the units are the same.
 */
export function DispenseForm({ prescriptionId, items, stock }: { prescriptionId: string; items: PrescriptionLine[]; stock: DispensableStock[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [rows, setRows] = React.useState(() => Object.fromEntries(items.map((i) => [i.id, { stock: "", quantity: "" }])));
  const [note, setNote] = React.useState("");
  const set = (itemId: string, patch: Partial<{ stock: string; quantity: string }>) => setRows({ ...rows, [itemId]: { ...rows[itemId]!, ...patch } });
  const lines = items
    .filter((i) => rows[i.id]?.stock && rows[i.id]?.quantity)
    .map((i) => {
      const [locationId, inventoryItemId] = rows[i.id]!.stock.split("|") as [string, string];
      return { prescriptionItemId: i.id, locationId, inventoryItemId, quantity: Number.parseInt(rows[i.id]!.quantity, 10) };
    });

  const submit = () =>
    startTransition(async () => {
      const result = await dispense({ prescriptionId, lines, note: note || undefined });
      if (result.ok) {
        toast.success("Dispensed; stock updated");
        setRows(Object.fromEntries(items.map((i) => [i.id, { stock: "", quantity: "" }])));
        setNote("");
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Dispense</CardTitle>
      </CardHeader>
      <CardContent>
        {stock.length === 0 ? (
          <p className="text-body text-muted-foreground">No medicines or supplies in stock at this facility.</p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {items.map((item) => {
              const chosen = stock.find((s) => stockKey(s) === rows[item.id]?.stock);
              return (
                <fieldset key={item.id} className="flex flex-col gap-2 rounded-md border p-2">
                  <legend className="text-label px-1 font-medium">
                    {item.lineNumber}. {item.genericName} {item.strength ?? ""} · #{item.quantity} {item.quantityUnit}
                  </legend>
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`dispense-stock-${item.id}`}>From stock</Label>
                      <NativeSelect id={`dispense-stock-${item.id}`} value={rows[item.id]!.stock} onChange={(e) => set(item.id, { stock: e.target.value })}>
                        <option value="">Not now</option>
                        {ranked(stock, item.genericName).map((s) => (
                          <option key={stockKey(s)} value={stockKey(s)}>
                            {s.itemName} · {s.locationName} ({s.quantity} {s.stockUnit}){s.controlled ? " · controlled" : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`dispense-qty-${item.id}`}>{chosen ? `Qty (${chosen.stockUnit})` : "Qty"}</Label>
                      <Input
                        id={`dispense-qty-${item.id}`}
                        inputMode="numeric"
                        value={rows[item.id]!.quantity}
                        onChange={(e) => set(item.id, { quantity: e.target.value.replace(/\D/g, "") })}
                      />
                    </div>
                  </div>
                </fieldset>
              );
            })}
            <div className="flex flex-col gap-1">
              <Label htmlFor="dispense-note">Note (optional)</Label>
              <Textarea id="dispense-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="submit" disabled={pending || lines.length === 0}>
              Dispense {lines.length ? `${lines.length} item${lines.length === 1 ? "" : "s"}` : ""}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Reverses a mistaken dispense with a reason; the stock returns to the same lots. */
export function ReverseDispense({ dispenseId }: { dispenseId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Reverse…
      </Button>
    );
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await reverseDispense({ dispenseId, reason });
          if (result.ok) {
            toast.success("Dispense reversed; stock returned");
            setOpen(false);
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="flex min-w-64 flex-1 flex-col gap-1">
        <Label htmlFor={`reverse-${dispenseId}`}>Why is it reversed?</Label>
        <Input id={`reverse-${dispenseId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending || reason.trim().length < 5}>
        Reverse dispense
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Keep
      </Button>
    </form>
  );
}
