"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { PurchaseOrder } from "@/lib/api/types";
import type { PurchaseOrderAction } from "@/lib/inventory-mapping";
import { approvePurchaseOrder, endPurchaseOrder, receivePurchaseOrder, submitPurchaseOrder } from "../../actions";

type Result = { ok: true } | { ok: false; message: string };

/** Submit, approve, receive a delivery, cancel or close short — whichever the order's status and the user's permissions allow. */
export function PurchaseOrderActions({ order, actions }: { order: PurchaseOrder; actions: PurchaseOrderAction[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const run = (call: () => Promise<Result>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });
  const ref = { id: order.id, version: order.version };

  return (
    <div className="flex h-fit flex-col gap-3">
      {actions.includes("submit") || actions.includes("approve") ? (
        <Card>
          <CardContent className="flex flex-wrap gap-2">
            {actions.includes("submit") ? (
              <Button disabled={pending} onClick={() => run(() => submitPurchaseOrder(ref), "Submitted for approval")}>
                Submit for approval
              </Button>
            ) : null}
            {actions.includes("approve") ? (
              <Button disabled={pending} onClick={() => run(() => approvePurchaseOrder(ref), "Purchase order approved")}>
                Approve
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {actions.includes("receive") ? <ReceiveDelivery order={order} pending={pending} run={run} /> : null}
      {actions.includes("cancel") || actions.includes("close") ? <EndOrder order={order} actions={actions} pending={pending} run={run} /> : null}
    </div>
  );
}

function ReceiveDelivery({
  order,
  pending,
  run,
}: {
  order: PurchaseOrder;
  pending: boolean;
  run: (call: () => Promise<Result>, success: string, after?: () => void) => void;
}) {
  const open = order.lines.filter((l) => l.outstanding > 0);
  const [reference, setReference] = React.useState("");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [rows, setRows] = React.useState(() => Object.fromEntries(open.map((l) => [l.id, { quantity: "", lotNumber: "", expiryDate: "" }])));
  const set = (lineId: string, patch: Partial<(typeof rows)[string]>) => setRows({ ...rows, [lineId]: { ...rows[lineId]!, ...patch } });
  const lines = open
    .filter((l) => rows[l.id]?.quantity)
    .map((l) => ({
      lineId: l.id,
      quantity: Number.parseInt(rows[l.id]!.quantity, 10),
      lotNumber: rows[l.id]!.lotNumber || undefined,
      expiryDate: rows[l.id]!.expiryDate || undefined,
    }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Receive a delivery</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => receivePurchaseOrder({ id: order.id, reference, lines, idempotencyKey: key }),
              "Delivery received into stock",
              () => setKey(crypto.randomUUID()),
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="dr-reference">Delivery receipt / invoice no.</Label>
            <Input id="dr-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          {open.map((l) => (
            <fieldset key={l.id} className="flex flex-col gap-1 rounded-md border p-2">
              <legend className="text-label px-1 font-medium">
                {l.item.name} · {l.outstanding} {l.item.stockUnit} to come
              </legend>
              <div className={`grid gap-2 ${l.item.tracksLots ? "grid-cols-3" : "grid-cols-1"}`}>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`dr-qty-${l.id}`}>Arrived</Label>
                  <Input
                    id={`dr-qty-${l.id}`}
                    inputMode="numeric"
                    value={rows[l.id]!.quantity}
                    onChange={(e) => set(l.id, { quantity: e.target.value.replace(/\D/g, "") })}
                  />
                </div>
                {l.item.tracksLots ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`dr-lot-${l.id}`}>Lot no.</Label>
                      <Input id={`dr-lot-${l.id}`} value={rows[l.id]!.lotNumber} onChange={(e) => set(l.id, { lotNumber: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`dr-exp-${l.id}`}>Expiry</Label>
                      <Input id={`dr-exp-${l.id}`} type="date" value={rows[l.id]!.expiryDate} onChange={(e) => set(l.id, { expiryDate: e.target.value })} />
                    </div>
                  </>
                ) : null}
              </div>
            </fieldset>
          ))}
          <Button type="submit" disabled={pending || !reference.trim() || lines.length === 0}>
            Receive into {order.location?.name ?? "stock"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EndOrder({
  order,
  actions,
  pending,
  run,
}: {
  order: PurchaseOrder;
  actions: PurchaseOrderAction[];
  pending: boolean;
  run: (call: () => Promise<Result>, success: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const ref = { id: order.id, version: order.version, reason };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{actions.includes("close") ? "No more deliveries?" : "Withdraw the order"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Label htmlFor="po-end-reason">Reason</Label>
        <Textarea id="po-end-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {actions.includes("cancel") ? (
            <Button
              variant="outline"
              disabled={pending || reason.trim().length < 5}
              onClick={() => run(() => endPurchaseOrder({ ...ref, action: "cancel" }), "Purchase order cancelled")}
            >
              Cancel order
            </Button>
          ) : null}
          {actions.includes("close") ? (
            <Button
              variant="outline"
              disabled={pending || reason.trim().length < 5}
              onClick={() => run(() => endPurchaseOrder({ ...ref, action: "close" }), "Purchase order closed")}
            >
              Close short
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
