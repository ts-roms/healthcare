"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PiggyBankIcon, PlusIcon, PrinterIcon, RotateCcwIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { AccountEntry, PatientAccount, PaymentMethod, SharedAccount } from "@/lib/api/types";
import { ACCOUNT_ENTRY_LABEL, addsToAccount, METHOD_LABEL, parsePesos, peso, pesoInput } from "@/lib/billing-mapping";
import { fileHref } from "@/lib/files";
import { recordDeposit, refundAccount } from "../../actions";

/**
 * The patient's deposit and credit balance at this facility: deposits
 * (advance payments) received, credit from credit notes, what was applied to
 * invoices, and refunds. The balance is applied from the invoice workspace.
 * The API derives the balance from its ledger and enforces every limit.
 */
export function PatientAccountPanel({
  patientId,
  account,
  canDeposit,
  canRefund,
}: {
  patientId: string;
  account: PatientAccount & Partial<SharedAccount>;
  canDeposit: boolean;
  canRefund: boolean;
}) {
  const entries = [...account.entries].reverse();
  // With deposits usable across facilities, what the other facilities hold can be applied or refunded here too.
  const usable = account.organizationBalance ?? account.balance;
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <PiggyBankIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Deposit and credit</CardTitle>
        <span className="ml-auto text-body font-semibold tabular-nums">{peso(account.balance)}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {account.facilities && account.facilities.some((f) => f.facilityId !== account.facilityId && f.balance > 0) ? (
          <div className="mx-4 rounded-md border bg-muted/40 p-2 text-table">
            <span className="font-medium">Usable at any facility: {peso(account.organizationBalance ?? 0)}</span>
            <ul>
              {account.facilities.map((f) => (
                <li key={f.facilityId} className="flex justify-between gap-2 text-muted-foreground">
                  <span>{f.facilityName}</span>
                  <span className="tabular-nums">{peso(f.balance)}</span>
                </li>
              ))}
            </ul>
            <span className="text-meta text-muted-foreground">Balance at another facility is moved here when applied or refunded.</span>
          </div>
        ) : null}
        {entries.length === 0 ? <p className="px-4 text-body text-muted-foreground">No deposits or credit at this facility.</p> : null}
        <ul className="divide-y">
          {entries.map((e) => (
            <Entry key={e.id} entry={e} />
          ))}
        </ul>
        {usable > 0 ? <p className="px-4 text-meta text-muted-foreground">Apply the balance to an issued invoice from the invoice&apos;s payments.</p> : null}
        {canDeposit ? <DepositForm patientId={patientId} /> : null}
        {canRefund && usable > 0 ? <RefundForm patientId={patientId} balance={usable} /> : null}
      </CardContent>
    </Card>
  );
}

function Entry({ entry: e }: { entry: AccountEntry }) {
  const adds = addsToAccount(e.kind);
  return (
    <li className="flex items-start gap-2 px-4 py-2 text-body">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">
          {ACCOUNT_ENTRY_LABEL[e.kind]}
          {e.invoiceId && e.invoiceNumber ? (
            <>
              {" "}
              <Link href={`/billing/invoices/${e.invoiceId}`} className="font-mono text-table text-primary hover:underline">
                {e.invoiceNumber}
              </Link>
            </>
          ) : null}
          {e.creditNoteId && e.creditNoteNumber ? (
            <>
              {" "}
              <a href={fileHref.creditNote(e.creditNoteId)} target="_blank" rel="noreferrer" className="font-mono text-table text-primary hover:underline">
                {e.creditNoteNumber}
              </a>
            </>
          ) : null}
        </span>
        <span className="block text-meta text-muted-foreground">
          {clinicalDateTime(e.recordedAt)}
          {e.method ? ` · ${METHOD_LABEL[e.method]}` : ""}
          {e.reference ? ` · ${e.reference}` : ""}
          {e.reason ? ` · ${e.reason}` : ""}
        </span>
        {e.kind === "deposit" && e.receiptNumber ? (
          <a
            href={fileHref.depositReceipt(e.id)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-table text-primary hover:underline"
          >
            <PrinterIcon className="size-3.5" aria-hidden /> {e.receiptNumber}
          </a>
        ) : null}
      </span>
      <span className="tabular-nums">{adds ? `+${peso(e.amount)}` : `−${peso(e.amount)}`}</span>
    </li>
  );
}

function useSubmit() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const submit = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string, after: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after();
        router.refresh();
      } else toast.error(result.message);
    });
  return { pending, submit };
}

function DepositForm({ patientId }: { patientId: string }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [reference, setReference] = React.useState("");
  // One key per real-world deposit: a retried submit is recorded once; a new key after success.
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  if (!open) {
    return (
      <div className="px-4">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <PlusIcon /> Record a deposit
        </Button>
      </div>
    );
  }
  const centavos = parsePesos(amount);
  return (
    <form
      className="mx-4 grid gap-2 rounded-lg border p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (centavos === null || centavos <= 0) {
          toast.error("Enter the amount in pesos, e.g. 1000.00");
          return;
        }
        submit(
          () => recordDeposit({ patientId, amount: centavos, method, reference: reference.trim() || undefined, idempotencyKey: key }),
          `Deposit of ${peso(centavos)} recorded`,
          () => {
            setKey(crypto.randomUUID());
            setAmount("");
            setReference("");
            setOpen(false);
          },
        );
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="deposit-amount">Amount (₱)</Label>
        <Input id="deposit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="deposit-method">Method</Label>
        <NativeSelect id="deposit-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="deposit-reference">Reference</Label>
        <Input id="deposit-reference" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} placeholder="Card, e-wallet…" />
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending}>
          Record deposit
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className="text-meta text-muted-foreground sm:col-span-3">
        A deposit gets an acknowledgement receipt number. Whether it can serve as a BIR official receipt must be confirmed before production use.
      </p>
    </form>
  );
}

function RefundForm({ patientId, balance }: { patientId: string; balance: number }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(pesoInput(balance));
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [reason, setReason] = React.useState("");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  if (!open) {
    return (
      <div className="px-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <RotateCcwIcon /> Refund balance…
        </Button>
      </div>
    );
  }
  const centavos = parsePesos(amount);
  return (
    <form
      className="mx-4 grid gap-2 rounded-lg border p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (centavos === null || centavos <= 0) {
          toast.error("Enter the amount in pesos");
          return;
        }
        submit(
          () => refundAccount({ patientId, amount: centavos, method, reason, idempotencyKey: key }),
          "Refund recorded",
          () => {
            setKey(crypto.randomUUID());
            setReason("");
            setOpen(false);
          },
        );
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="account-refund-amount">Amount (₱, up to {peso(balance)})</Label>
        <Input id="account-refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="account-refund-method">Method</Label>
        <NativeSelect id="account-refund-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="account-refund-reason">Reason</Label>
        <Input id="account-refund-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" variant="destructive" disabled={pending || reason.trim().length < 3}>
          Refund
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep
        </Button>
      </div>
      <p className="text-meta text-muted-foreground sm:col-span-3">Refunds are recorded with your name and the reason.</p>
    </form>
  );
}
