"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@healthcare/ui/primitives";
import type { PurchaseOrderInvoicing } from "@/lib/api/types";
import { parsePesos, peso, pesoInput } from "@/lib/billing-mapping";
import { recordSupplierInvoice } from "../../actions";

/**
 * Record a supplier invoice against the order: each line starts with what was received and not yet invoiced, at the
 * order's price. The API refuses more than that; a different price is recorded and shown for approval.
 */
export function RecordSupplierInvoice({ invoicing }: { invoicing: PurchaseOrderInvoicing }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const open = invoicing.lines.filter((l) => l.invoiceable > 0);
  const initial = () => ({
    invoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    vat: "0.00",
    lines: open.map((l) => ({ id: l.purchaseOrderLineId, quantity: String(l.invoiceable), price: l.orderUnitCost === null ? "" : pesoInput(l.orderUnitCost) })),
  });
  const [f, setF] = React.useState(initial);
  const setLine = (index: number, patch: Partial<(typeof f.lines)[number]>) =>
    setF({ ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  const submit = () => {
    const lines = f.lines
      .filter((l) => Number(l.quantity) > 0)
      .map((l) => ({ purchaseOrderLineId: l.id, quantity: Number(l.quantity), unitPrice: parsePesos(l.price) ?? -1 }));
    if (lines.some((l) => l.unitPrice < 0 || !Number.isInteger(l.quantity))) {
      toast.error("Enter a whole quantity and a price for each line invoiced.");
      return;
    }
    const vatAmount = parsePesos(f.vat);
    if (vatAmount === null) {
      toast.error("Enter the VAT as stated on the invoice (0.00 if none).");
      return;
    }
    startTransition(async () => {
      const result = await recordSupplierInvoice({
        purchaseOrderId: invoicing.purchaseOrderId,
        invoiceNumber: f.invoiceNumber,
        invoiceDate: f.invoiceDate,
        dueDate: f.dueDate || undefined,
        vatAmount,
        lines,
      });
      if (result.ok) {
        toast.success("Supplier invoice recorded");
        setF(initial());
        router.refresh();
      } else toast.error(result.message);
    });
  };

  if (open.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a supplier invoice</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="invoice-number">Supplier invoice number</Label>
            <Input id="invoice-number" value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="invoice-vat">VAT on the invoice (₱)</Label>
            <Input id="invoice-vat" inputMode="decimal" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="invoice-date">Invoice date</Label>
            <Input id="invoice-date" type="date" value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="invoice-due">Due date (optional)</Label>
            <Input id="invoice-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </div>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-table font-medium">Lines (received, not yet invoiced)</legend>
          {open.map((l, i) => (
            <div key={l.purchaseOrderLineId} className="grid grid-cols-[1fr_6rem_7rem] items-end gap-2">
              <div className="text-table">
                {l.itemName}
                <span className="block text-meta text-muted-foreground">
                  up to {l.invoiceable} {l.stockUnit}
                  {l.orderUnitCost === null ? " · no order price" : ` · ordered at ${peso(l.orderUnitCost)}`}
                </span>
              </div>
              <Input
                aria-label={`Quantity of ${l.itemName}`}
                inputMode="numeric"
                value={f.lines[i]?.quantity ?? ""}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
              />
              <Input
                aria-label={`Unit price of ${l.itemName} (₱)`}
                inputMode="decimal"
                value={f.lines[i]?.price ?? ""}
                onChange={(e) => setLine(i, { price: e.target.value })}
              />
            </div>
          ))}
        </fieldset>
        <Button className="self-start" disabled={pending || !f.invoiceNumber.trim() || !f.invoiceDate} onClick={submit}>
          Record invoice
        </Button>
      </CardContent>
    </Card>
  );
}
