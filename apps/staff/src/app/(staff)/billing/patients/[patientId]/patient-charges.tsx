"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileTextIcon, PlusIcon, XIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { BillingCharge, BillingService } from "@/lib/api/types";
import { CATEGORY_LABEL, CHARGE_SOURCE_LABEL, parsePesos, peso, pesoInput } from "@/lib/billing-mapping";
import { addCharge, cancelCharge, createInvoice } from "../../actions";

/** Pending charges of one patient: choose what to invoice, add a charge, or cancel one with a reason. */
export function PatientCharges({
  patientId,
  charges,
  services,
  canCapture,
  canInvoice,
}: {
  patientId: string;
  charges: BillingCharge[];
  services: BillingService[];
  canCapture: boolean;
  canInvoice: boolean;
}) {
  const router = useRouter();
  // Everything is included unless unticked, so charges that arrive later (a refresh) are included too.
  const [excluded, setExcluded] = React.useState<Set<string>>(() => new Set());
  const [pending, startTransition] = React.useTransition();
  const chosen = charges.filter((c) => !excluded.has(c.id));

  const prepare = () =>
    startTransition(async () => {
      const result = await createInvoice({ patientId, chargeIds: chosen.length === charges.length ? undefined : chosen.map((c) => c.id) });
      if (result.ok) router.push(`/billing/invoices/${result.data.id}`);
      else toast.error(result.message);
    });

  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Charges to invoice</CardTitle>
        <span className="ml-auto text-meta text-muted-foreground">{charges.length} pending</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {charges.length === 0 ? <p className="px-4 text-body text-muted-foreground">No pending charges.</p> : null}
        <ul className="divide-y">
          {charges.map((c) => (
            <ChargeRow
              key={c.id}
              charge={c}
              checked={!excluded.has(c.id)}
              onCheck={(on) =>
                setExcluded((s) => {
                  const next = new Set(s);
                  if (on) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
              canCapture={canCapture}
            />
          ))}
        </ul>
        {canInvoice && charges.length ? (
          <div className="flex items-center gap-3 px-4">
            <Button type="button" onClick={prepare} disabled={pending || chosen.length === 0}>
              <FileTextIcon /> Prepare invoice ({chosen.length})
            </Button>
            <span className="text-body font-medium tabular-nums">{peso(chosen.reduce((a, c) => a + c.amount, 0))}</span>
          </div>
        ) : null}
        {canCapture ? <AddCharge patientId={patientId} services={services} /> : null}
      </CardContent>
    </Card>
  );
}

function ChargeRow({
  charge: c,
  checked,
  onCheck,
  canCapture,
}: {
  charge: BillingCharge;
  checked: boolean;
  onCheck: (on: boolean) => void;
  canCapture: boolean;
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const cancel = () =>
    startTransition(async () => {
      const result = await cancelCharge({ chargeId: c.id, reason, version: c.version });
      if (result.ok) {
        toast.success(`Cancelled: ${c.description}`);
        router.refresh();
      } else toast.error(result.message);
    });
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheck(v === true)} aria-label={`Include ${c.description}`} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">
          {c.description}
          {c.quantity > 1 ? <span className="text-muted-foreground"> × {c.quantity}</span> : null}
        </span>
        <span className="block text-meta text-muted-foreground">
          {clinicalDate(c.serviceDate)} · {CHARGE_SOURCE_LABEL[c.sourceType]}
        </span>
      </span>
      <Badge variant="neutral">{CATEGORY_LABEL[c.category]}</Badge>
      <span className="w-24 text-right font-medium tabular-nums">{peso(c.amount)}</span>
      {canCapture ? (
        cancelling ? (
          <span className="flex w-full items-center justify-end gap-1.5">
            <Input
              aria-label="Reason for cancelling"
              className="h-7 w-56"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason"
            />
            <Button type="button" size="xs" variant="destructive" onClick={cancel} disabled={pending || reason.trim().length < 3}>
              Cancel charge
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setCancelling(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setCancelling(true)} aria-label={`Cancel ${c.description}`}>
            <XIcon />
          </Button>
        )
      ) : null}
    </li>
  );
}

function AddCharge({ patientId, services }: { patientId: string; services: BillingService[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [serviceId, setServiceId] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [price, setPrice] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const service = services.find((s) => s.id === serviceId);
  const typed = price.trim() ? parsePesos(price) : null;
  const overriding = service !== undefined && typed !== null && typed !== service.currentPrice;

  const choose = (id: string) => {
    setServiceId(id);
    const s = services.find((x) => x.id === id);
    setPrice(s?.currentPrice !== null && s?.currentPrice !== undefined ? pesoInput(s.currentPrice) : "");
    setReason("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!service) return;
    if (price.trim() && typed === null) {
      toast.error("Enter the price in pesos, e.g. 500.00");
      return;
    }
    startTransition(async () => {
      const result = await addCharge({
        patientId,
        serviceId: service.id,
        quantity: Number(quantity) || 1,
        unitPrice: overriding || service.currentPrice === null ? (typed ?? undefined) : undefined,
        priceOverrideReason: overriding && service.currentPrice !== null ? reason : undefined,
      });
      if (result.ok) {
        toast.success(`Added: ${result.data.description}`);
        setOpen(false);
        setServiceId("");
        router.refresh();
      } else toast.error(result.message);
    });
  };

  if (!open) {
    return (
      <div className="px-4">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <PlusIcon /> Add a charge
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mx-4 grid gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_80px_1fr]">
      <div className="flex flex-col gap-1">
        <Label htmlFor="charge-service">Service</Label>
        <NativeSelect placeholder="Choose…" id="charge-service" value={serviceId} onChange={(e) => choose(e.target.value)} required>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.currentPrice !== null ? `— ${peso(s.currentPrice)}` : "— no price set"}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="charge-qty">Qty</Label>
        <Input id="charge-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="charge-price">Unit price (₱)</Label>
        <Input id="charge-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
      </div>
      {overriding && service?.currentPrice !== null ? (
        <div className="flex flex-col gap-1 sm:col-span-3">
          <Label htmlFor="charge-reason">Reason for a different price (listed {peso(service?.currentPrice ?? 0)})</Label>
          <Input id="charge-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
        </div>
      ) : null}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending || !service}>
          Add charge
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
