"use client";

import * as React from "react";
import { FileMinusIcon, FilePlusIcon, GlobeIcon, PlusIcon, PrinterIcon, ReceiptTextIcon, XIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { BillingService, InvoiceFull, OnlinePayment } from "@/lib/api/types";
import { coverageCreditable, creditableLeft, parsePesos, peso, pesoInput } from "@/lib/billing-mapping";
import { fileHref } from "@/lib/files";
import { issueCreditNote, issueDebitNote } from "../../actions";
import { useAction } from "./invoice-action";

const ONLINE_STATUS: Record<OnlinePayment["status"], { label: string; variant: "neutral" | "success" | "warning" | "danger" }> = {
  pending: { label: "Waiting for the provider", variant: "warning" },
  succeeded: { label: "Paid", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  cancelled: { label: "Cancelled", variant: "neutral" },
  expired: { label: "Expired", variant: "neutral" },
};

/** The VAT breakdown recorded when the invoice was issued, from the organization's own settings. */
export function VatBreakdown({ invoice }: { invoice: InvoiceFull }) {
  const rows: Array<[string, number]> = [
    ["VATable sales", invoice.vatableSales],
    [`VAT (${(invoice.vatRateBp ?? 0) / 100}%)`, invoice.vatAmount],
    ["VAT-exempt sales", invoice.vatExemptSales],
    ["Zero-rated sales", invoice.zeroRatedSales],
  ];
  return (
    <Card>
      <CardHeader>
        <ReceiptTextIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>VAT breakdown</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
          {rows.map(([label, amount]) => (
            <React.Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right tabular-nums">{peso(amount)}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="text-meta text-muted-foreground">
          {invoice.sellerRegisteredName ?? "Seller"}
          {invoice.sellerTin ? ` · TIN ${invoice.sellerTin}` : ""}. Computed from the organization&apos;s tax settings; whether they meet BIR requirements must
          be confirmed.
        </p>
      </CardContent>
    </Card>
  );
}

/** Payments the patient started online through the payment provider, whatever their outcome. */
export function OnlinePayments({ invoice }: { invoice: InvoiceFull }) {
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <GlobeIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Online payments</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-4">
        <ul className="divide-y">
          {invoice.onlinePayments.map((o) => (
            <li key={o.id} className="flex items-center gap-2 px-4 py-2 text-body">
              <span className="min-w-0 flex-1">
                {peso(o.amount)} through {o.provider}
                <span className="block text-meta text-muted-foreground">
                  Started {clinicalDateTime(o.createdAt)}
                  {o.failureCode ? ` · ${o.failureCode}` : ""}
                </span>
              </span>
              <Badge variant={ONLINE_STATUS[o.status].variant}>{ONLINE_STATUS[o.status].label}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type DebitRow = { key: string; serviceId: string; description: string; quantity: string; price: string };

/** Debit notes of an issued invoice, and issuing one: services at their listed price, or adjustments described in words. */
export function DebitNotes({ invoice, services, canIssue }: { invoice: InvoiceFull; services: BillingService[]; canIssue: boolean }) {
  const { pending, run } = useAction();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const blank = (): DebitRow => ({ key: crypto.randomUUID(), serviceId: "", description: "", quantity: "1", price: "" });
  const [rows, setRows] = React.useState<DebitRow[]>(() => [blank()]);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const priced = services.filter((s) => s.status === "active" && !("isPackage" in s && s.isPackage));
  const lines = rows.map((r) => {
    const service = priced.find((s) => s.id === r.serviceId);
    const typed = r.price.trim() ? parsePesos(r.price) : null;
    const unitPrice = typed ?? service?.currentPrice ?? null;
    return {
      row: r,
      service,
      unitPrice,
      quantity: Number(r.quantity) || 0,
      valid: (service !== undefined || r.description.trim() !== "") && unitPrice !== null && unitPrice > 0,
    };
  });
  const total = lines.reduce((a, l) => a + (l.unitPrice ?? 0) * l.quantity, 0);
  const update = (k: string, patch: Partial<DebitRow>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader>
        <FilePlusIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Debit notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {invoice.debitNotes.length === 0 ? <p className="text-body text-muted-foreground">None.</p> : null}
        <ul className="flex flex-col gap-2">
          {invoice.debitNotes.map((d) => (
            <li key={d.id} className="text-body">
              <span className="flex items-baseline gap-2">
                <a
                  href={fileHref.debitNote(d.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-mono text-table text-primary hover:underline"
                >
                  <PrinterIcon className="size-3.5" aria-hidden /> {d.debitNoteNumber}
                </a>
                <span className="ml-auto tabular-nums">+{peso(d.amount)}</span>
              </span>
              <span className="block text-meta text-muted-foreground">
                {clinicalDateTime(d.issuedAt)} · {d.reason}
              </span>
            </li>
          ))}
        </ul>
        {canIssue ? (
          open ? (
            <form
              className="flex flex-col gap-2 rounded-lg border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (lines.some((l) => !l.valid || l.quantity < 1)) {
                  toast.error("Each line needs a service or a description, a quantity and a price.");
                  return;
                }
                run(
                  () =>
                    issueDebitNote({
                      invoiceId: invoice.id,
                      reason,
                      idempotencyKey: key,
                      lines: lines.map((l) => ({
                        serviceId: l.service?.id,
                        description: l.service ? undefined : l.row.description.trim(),
                        quantity: l.quantity,
                        unitPrice: l.row.price.trim() || !l.service ? (l.unitPrice ?? undefined) : undefined,
                      })),
                    }),
                  "Debit note issued",
                  () => {
                    setKey(crypto.randomUUID());
                    setRows([blank()]);
                    setReason("");
                    setOpen(false);
                  },
                );
              }}
            >
              {rows.map((r, i) => (
                <div key={r.key} className="grid grid-cols-[1fr_4rem_6rem_auto] items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`debit-service-${r.key}`}>{i === 0 ? "Service or adjustment" : <span className="sr-only">Service</span>}</Label>
                    <NativeSelect
                      emptyText="No priced services"
                      id={`debit-service-${r.key}`}
                      value={r.serviceId}
                      onChange={(e) => update(r.key, { serviceId: e.target.value, price: "" })}
                    >
                      <option value="">An adjustment (describe it)</option>
                      {priced.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.currentPrice !== null ? `— ${peso(s.currentPrice)}` : ""}
                        </option>
                      ))}
                    </NativeSelect>
                    {r.serviceId ? null : (
                      <Input
                        aria-label="Description"
                        value={r.description}
                        maxLength={200}
                        placeholder="What is added"
                        onChange={(e) => update(r.key, { description: e.target.value })}
                      />
                    )}
                  </div>
                  <Input
                    aria-label="Quantity"
                    inputMode="numeric"
                    value={r.quantity}
                    onChange={(e) => update(r.key, { quantity: e.target.value.replace(/\D/g, "") })}
                  />
                  <Input
                    aria-label="Unit price (₱)"
                    inputMode="decimal"
                    value={r.price}
                    placeholder={lines[i]?.service?.currentPrice != null ? pesoInput(lines[i]?.service?.currentPrice ?? 0) : "0.00"}
                    onChange={(e) => update(r.key, { price: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove line"
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
              <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => setRows((rs) => [...rs, blank()])}>
                <PlusIcon /> Line
              </Button>
              <Label htmlFor="debit-reason">Reason</Label>
              <Input id="debit-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
              <p className="text-body font-medium tabular-nums">Adds {peso(total)}</p>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending || reason.trim().length < 3}>
                  Issue debit note
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
              <p className="text-meta text-muted-foreground">
                A debit note is numbered and cannot be changed; it adds to what the patient owes. A mistake is corrected with a credit note. Whether the
                document meets BIR requirements must be confirmed before production use.
              </p>
            </form>
          ) : (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
              <FilePlusIcon /> Issue debit note…
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Credit notes of an issued invoice, and issuing one: amounts per line of the invoice or of its debit notes (at most
 * what is left of each), optionally part of it off a payer's open claim, with a reason.
 */
export function CreditNotes({ invoice, canIssue }: { invoice: InvoiceFull; canIssue: boolean }) {
  const { pending, run } = useAction();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});
  const [payerAmounts, setPayerAmounts] = React.useState<Record<string, string>>({});
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const targets = [
    ...invoice.items.map((item) => ({ id: item.id, kind: "item" as const, description: item.description, amount: item.netAmount })),
    ...invoice.debitNotes.flatMap((d) =>
      d.lines.map((l) => ({ id: l.id, kind: "debit" as const, description: `${l.description} (${d.debitNoteNumber})`, amount: l.amount })),
    ),
  ].map((t) => ({ ...t, left: creditableLeft(t, invoice.creditNotes), typed: amounts[t.id]?.trim() ?? "" }));
  const chosen = targets.filter((t) => t.typed !== "").map((t) => ({ ...t, value: parsePesos(t.typed) }));
  const payers = invoice.payers.map((p) => ({ ...p, left: coverageCreditable(p), typed: payerAmounts[p.id]?.trim() ?? "" })).filter((p) => p.left > 0);
  const payerChosen = payers.filter((p) => p.typed !== "").map((p) => ({ ...p, value: parsePesos(p.typed) }));
  const total = chosen.reduce((a, l) => a + (l.value ?? 0), 0);
  const payerTotal = payerChosen.reduce((a, p) => a + (p.value ?? 0), 0);
  const invalid =
    chosen.some((l) => l.value === null || l.value <= 0 || l.value > l.left) ||
    payerChosen.some((p) => p.value === null || p.value <= 0 || p.value > p.left) ||
    payerTotal > total;

  return (
    <Card>
      <CardHeader>
        <FileMinusIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Credit notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {invoice.creditNotes.length === 0 ? <p className="text-body text-muted-foreground">None.</p> : null}
        <ul className="flex flex-col gap-2">
          {invoice.creditNotes.map((c) => (
            <li key={c.id} className="text-body">
              <span className="flex items-baseline gap-2">
                <a
                  href={fileHref.creditNote(c.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-mono text-table text-primary hover:underline"
                >
                  <PrinterIcon className="size-3.5" aria-hidden /> {c.creditNoteNumber}
                </a>
                <span className="ml-auto tabular-nums">−{peso(c.amount)}</span>
              </span>
              <span className="block text-meta text-muted-foreground">
                {clinicalDateTime(c.issuedAt)} · {c.reason}
              </span>
              {c.payerAmount ? <span className="block text-meta text-muted-foreground">{peso(c.payerAmount)} off payers&apos; coverage</span> : null}
              {c.accountCredit ? (
                <span className="block text-meta text-muted-foreground">{peso(c.accountCredit)} already paid went to the patient&apos;s account</span>
              ) : null}
            </li>
          ))}
        </ul>
        {canIssue ? (
          open ? (
            <form
              className="flex flex-col gap-2 rounded-lg border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (chosen.length === 0 || invalid) {
                  toast.error("Enter an amount for each line to credit, at most what is left of it; the payers' part cannot exceed the total.");
                  return;
                }
                run(
                  () =>
                    issueCreditNote({
                      invoiceId: invoice.id,
                      reason,
                      lines: chosen.map((l) => ({
                        invoiceItemId: l.kind === "item" ? l.id : undefined,
                        debitNoteLineId: l.kind === "debit" ? l.id : undefined,
                        amount: l.value ?? 0,
                      })),
                      payers: payerChosen.map((p) => ({ invoicePayerId: p.id, amount: p.value ?? 0 })),
                      idempotencyKey: key,
                    }),
                  "Credit note issued",
                  () => {
                    setKey(crypto.randomUUID());
                    setAmounts({});
                    setPayerAmounts({});
                    setReason("");
                    setOpen(false);
                  },
                );
              }}
            >
              {targets.map((t) => (
                <div key={t.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
                  <Label htmlFor={`credit-${t.id}`} className="flex flex-col items-start gap-0">
                    <span>{t.description}</span>
                    <span className="text-meta font-normal text-muted-foreground">Up to {peso(t.left)}</span>
                  </Label>
                  <Input
                    id={`credit-${t.id}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={t.left <= 0}
                    value={amounts[t.id] ?? ""}
                    onChange={(e) => setAmounts({ ...amounts, [t.id]: e.target.value })}
                  />
                </div>
              ))}
              {payers.length ? (
                <fieldset className="flex flex-col gap-2 border-t pt-2">
                  <legend className="text-meta text-muted-foreground">Of this, off a payer&apos;s open claim (the rest is the patient&apos;s)</legend>
                  {payers.map((p) => (
                    <div key={p.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
                      <Label htmlFor={`credit-payer-${p.id}`} className="flex flex-col items-start gap-0">
                        <span>{p.payerName}</span>
                        <span className="text-meta font-normal text-muted-foreground">Up to {peso(p.left)}</span>
                      </Label>
                      <Input
                        id={`credit-payer-${p.id}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={payerAmounts[p.id] ?? ""}
                        onChange={(e) => setPayerAmounts({ ...payerAmounts, [p.id]: e.target.value })}
                      />
                    </div>
                  ))}
                </fieldset>
              ) : null}
              <Label htmlFor="credit-reason">Reason</Label>
              <Input id="credit-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
              <p className="text-body font-medium tabular-nums">
                Total {peso(total)}
                {payerTotal ? ` · payers ${peso(payerTotal)} · patient ${peso(total - payerTotal)}` : ""}
              </p>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending || reason.trim().length < 3 || chosen.length === 0 || invalid}>
                  Issue credit note
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
              <p className="text-meta text-muted-foreground">
                A credit note is numbered and cannot be changed. The patient&apos;s part first reduces what they still owe; what they already paid goes to their
                deposit and credit balance. A payer&apos;s part reduces its open claim. Whether the document meets BIR requirements must be confirmed before
                production use.
              </p>
            </form>
          ) : (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
              <FileMinusIcon /> Issue credit note…
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
