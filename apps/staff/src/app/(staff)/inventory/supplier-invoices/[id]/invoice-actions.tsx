"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { SupplierInvoice } from "@/lib/api/types";
import type { SupplierInvoiceAction } from "@/lib/inventory-mapping";
import { approveSupplierInvoice, paySupplierInvoice, voidSupplierInvoice } from "../../actions";

type Result = { ok: true } | { ok: false; message: string };

/** Approve, mark paid or void — whichever the invoice's status and the user's permissions allow (the API decides). */
export function SupplierInvoiceActions({ invoice, actions, needsNote }: { invoice: SupplierInvoice; actions: SupplierInvoiceAction[]; needsNote: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");
  const [payment, setPayment] = React.useState({ paidOn: "", paymentReference: "" });
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
            <Button
              className="self-start"
              disabled={pending || !payment.paidOn || !payment.paymentReference.trim()}
              onClick={() => run(() => paySupplierInvoice({ ...ref, ...payment }), "Payment recorded")}
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
