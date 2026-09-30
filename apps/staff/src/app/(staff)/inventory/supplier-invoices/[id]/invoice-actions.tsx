"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { SupplierInvoice, WithholdingCode } from "@/lib/api/types";
import { parsePesos, peso } from "@/lib/billing-mapping";
import type { SupplierInvoiceAction } from "@/lib/inventory-mapping";
import { approveSupplierInvoice, paySupplierInvoice, voidSupplierInvoice } from "../../actions";

type Result = { ok: true } | { ok: false; message: string };

/** Approve, mark paid or void — whichever the invoice's status and the user's permissions allow (the API decides). */
export function SupplierInvoiceActions({
  invoice,
  actions,
  needsNote,
  withholdingCodes,
}: {
  invoice: SupplierInvoice;
  actions: SupplierInvoiceAction[];
  needsNote: boolean;
  /** The organization's own active withholding codes; the amount is entered, never computed. */
  withholdingCodes: WithholdingCode[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");
  const [payment, setPayment] = React.useState({ paidOn: "", paymentReference: "" });
  const [withholding, setWithholding] = React.useState({ codeId: "", amount: "", reference: "" });
  const withheld = withholding.codeId ? parsePesos(withholding.amount) : null;
  const withholdingInvalid = Boolean(withholding.codeId) && (withheld === null || withheld <= 0 || withheld > invoice.total);
  const [reason, setReason] = React.useState("");
  const ref = { id: invoice.id, version: invoice.version };
  const run = (call: () => Promise<Result>, success: string) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="flex h-fit flex-col gap-3">
      {actions.includes("approve") ? (
        <Card>
          <CardHeader>
            <CardTitle>Approve for payment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="approval-note">{needsNote ? "Why the price difference is accepted" : "Note (optional)"}</Label>
            <Textarea id="approval-note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button
              className="self-start"
              disabled={pending || (needsNote && note.trim().length < 3)}
              onClick={() => run(() => approveSupplierInvoice({ ...ref, note: note.trim() || undefined }), "Invoice approved for payment")}
            >
              Approve
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {actions.includes("pay") ? (
        <Card>
          <CardHeader>
            <CardTitle>Record the payment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="grid gap-1">
              <Label htmlFor="paid-on">Paid on</Label>
              <Input id="paid-on" type="date" value={payment.paidOn} onChange={(e) => setPayment({ ...payment, paidOn: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="payment-reference">Check number or transfer reference</Label>
              <Input id="payment-reference" value={payment.paymentReference} onChange={(e) => setPayment({ ...payment, paymentReference: e.target.value })} />
            </div>
            {withholdingCodes.length ? (
              <fieldset className="grid gap-2 rounded-md border p-2">
                <legend className="px-1 text-meta text-muted-foreground">Withheld from this payment (as your accountant determined)</legend>
                <div className="grid gap-1">
                  <Label htmlFor="withholding-code">Withholding code</Label>
                  <NativeSelect id="withholding-code" value={withholding.codeId} onChange={(e) => setWithholding({ ...withholding, codeId: e.target.value })}>
                    <option value="">Nothing withheld</option>
                    {withholdingCodes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.description}
                        {c.rateBasisPoints !== null ? ` (${c.rateBasisPoints / 100}% for reference)` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                {withholding.codeId ? (
                  <>
                    <div className="grid gap-1">
                      <Label htmlFor="withheld-amount">Amount withheld (PHP)</Label>
                      <Input
                        id="withheld-amount"
                        inputMode="decimal"
                        value={withholding.amount}
                        onChange={(e) => setWithholding({ ...withholding, amount: e.target.value })}
                      />
                      {withheld !== null && withheld > 0 && withheld <= invoice.total ? (
                        <p className="text-meta text-muted-foreground">Paid to the supplier: {peso(invoice.total - withheld)}</p>
                      ) : null}
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="withholding-reference">Certificate reference (optional)</Label>
                      <Input
                        id="withholding-reference"
                        maxLength={80}
                        value={withholding.reference}
                        onChange={(e) => setWithholding({ ...withholding, reference: e.target.value })}
                      />
                    </div>
                  </>
                ) : null}
              </fieldset>
            ) : null}
            <Button
              className="self-start"
              disabled={pending || !payment.paidOn || !payment.paymentReference.trim() || withholdingInvalid}
              onClick={() =>
                run(
                  () =>
                    paySupplierInvoice({
                      ...ref,
                      ...payment,
                      withholding:
                        withholding.codeId && withheld
                          ? { codeId: withholding.codeId, amount: withheld, reference: withholding.reference.trim() || undefined }
                          : undefined,
                    }),
                  "Payment recorded",
                )
              }
            >
              Mark paid
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {actions.includes("void") ? (
        <Card>
          <CardHeader>
            <CardTitle>Void</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-meta text-muted-foreground">A voided invoice stays on record; its quantities can be invoiced again.</p>
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button
              variant="destructive"
              className="self-start"
              disabled={pending || reason.trim().length < 5}
              onClick={() => run(() => voidSupplierInvoice({ ...ref, reason }), "Invoice voided")}
            >
              Void invoice
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
