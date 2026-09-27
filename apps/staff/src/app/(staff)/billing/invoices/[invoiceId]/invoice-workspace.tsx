"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BanIcon,
  BadgePercentIcon,
  BuildingIcon,
  CheckIcon,
  FileCheck2Icon,
  FileMinusIcon,
  PiggyBankIcon,
  RotateCcwIcon,
  Trash2Icon,
  WalletIcon,
  XIcon,
  PrinterIcon,
} from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import { InvoiceBadge } from "@/components/invoice-badge";
import { fileHref } from "@/lib/files";
import type { BillingPayer, DiscountRule, InvoiceCoverage, InvoiceWithSettlement, LedgerEntry, PaymentMethod } from "@/lib/api/types";
import {
  CATEGORY_LABEL,
  COVERAGE_STATUS_LABEL,
  creditableLeft,
  METHOD_LABEL,
  parsePesos,
  percent,
  peso,
  pesoInput,
  refundableAmount,
} from "@/lib/billing-mapping";
import {
  applyDeposit,
  applyDiscount,
  discardInvoice,
  issueCreditNote,
  issueInvoice,
  recordPayment,
  refundPayment,
  removeDiscount,
  removeLine,
  removePayer,
  setPayer,
  updateClaim,
  voidInvoice,
} from "../../actions";

interface Permissions {
  issue: boolean;
  discount: boolean;
  pay: boolean;
  refund: boolean;
  void: boolean;
  deposit: boolean;
  creditNote: boolean;
}

type Result = { ok: true; data?: unknown } | { ok: false; message: string };

/** Receives the invoice an action returns, so the next action uses its new version without waiting for the page refresh. */
const InvoiceUpdate = React.createContext<(invoice: InvoiceWithSettlement) => void>(() => undefined);

function isInvoice(value: unknown): value is InvoiceWithSettlement {
  return typeof value === "object" && value !== null && "items" in value && "version" in value;
}

/** Runs an action, toasts the outcome and refreshes the page data. */
function useAction() {
  const router = useRouter();
  const update = React.useContext(InvoiceUpdate);
  const [pending, startTransition] = React.useTransition();
  const run = (call: () => Promise<Result>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        if (isInvoice(result.data)) update(result.data);
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });
  return { pending, run };
}

/**
 * One invoice: a draft is prepared here (lines, discounts with evidence, payer
 * coverage) and issued; an issued invoice takes payments, refunds, claim
 * follow-up and a void. The API recomputes and enforces every amount.
 */
export function InvoiceWorkspace({
  invoice: loaded,
  rules,
  payers,
  accountBalance,
  can,
  aside,
}: {
  invoice: InvoiceWithSettlement;
  rules: DiscountRule[];
  payers: BillingPayer[];
  /** The patient's deposit and credit balance at the facility, when it can be applied here. */
  accountBalance: number | null;
  can: Permissions;
  /** Extra panels for the side column (e.g. the PhilHealth claim). */
  aside?: React.ReactNode;
}) {
  // The newest of what the page loaded and what the last action returned.
  const [latest, setLatest] = React.useState<InvoiceWithSettlement | null>(null);
  const invoice = latest && latest.id === loaded.id && latest.version > loaded.version ? latest : loaded;
  const draft = invoice.status === "draft";
  return (
    <InvoiceUpdate.Provider value={setLatest}>
      <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Lines invoice={invoice} canEdit={draft && can.issue} />
          {invoice.status === "issued" || invoice.payments.length ? <Payments key={invoice.balance} invoice={invoice} can={can} /> : null}
          {invoice.accountEntries.length || (accountBalance && invoice.balance > 0) ? (
            <DepositApplied key={`deposit-${invoice.balance}`} invoice={invoice} accountBalance={accountBalance} canApply={can.deposit} />
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <Summary invoice={invoice} can={can} />
          <Discounts invoice={invoice} rules={rules} canEdit={draft && can.discount} />
          <Coverage invoice={invoice} payers={payers} canEdit={draft && can.issue} canFollowUp={invoice.status === "issued" && can.issue} />
          {invoice.creditNotes.length || (invoice.status === "issued" && can.creditNote) ? (
            <CreditNotes invoice={invoice} canIssue={invoice.status === "issued" && can.creditNote} />
          ) : null}
          {aside}
        </div>
      </div>
    </InvoiceUpdate.Provider>
  );
}

function Summary({ invoice, can }: { invoice: InvoiceWithSettlement; can: Permissions }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [voiding, setVoiding] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [reissue, setReissue] = React.useState(true);
  const rows: Array<[string, number, boolean?]> = [
    ["Gross", invoice.grossTotal],
    ["Discounts", -invoice.discountTotal],
    ["Net", invoice.netTotal, true],
    ["Covered by payers", -invoice.payerTotal],
    ["Patient's share", invoice.patientTotal, true],
  ];
  if (invoice.status !== "draft") {
    rows.push(["Paid", -invoice.paidTotal]);
    if (invoice.depositAppliedTotal) rows.push(["Deposit applied", -invoice.depositAppliedTotal]);
    if (invoice.creditedTotal) rows.push(["Credit notes", -invoice.creditedTotal]);
    rows.push(["Balance", invoice.balance, true]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{invoice.invoiceNumber ?? "Draft"}</CardTitle>
        <span className="ml-auto">
          <InvoiceBadge invoice={invoice} />
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-meta text-muted-foreground">
          {invoice.status === "draft" ? `Started ${clinicalDateTime(invoice.createdAt)}` : `Issued ${clinicalDateTime(invoice.issuedAt ?? invoice.createdAt)}`}
          {invoice.voidedAt ? ` · voided ${clinicalDateTime(invoice.voidedAt)}` : ""}
        </p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
          {rows.map(([label, amount, strong]) => (
            <React.Fragment key={label}>
              <dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
              <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{peso(amount)}</dd>
            </React.Fragment>
          ))}
        </dl>
        {invoice.voidReason ? (
          <p className="rounded-md border border-danger/25 bg-danger-subtle p-2 text-table text-danger-foreground">
            <BanIcon className="mr-1 inline size-3.5" aria-hidden /> Void: {invoice.voidReason}
            {invoice.replacedById ? (
              <>
                {" · "}
                <Link href={`/billing/invoices/${invoice.replacedById}`} className="underline">
                  replacement
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        <Button asChild variant="outline" size="sm" className="self-start">
          <a href={fileHref.invoice(invoice.id)} target="_blank" rel="noreferrer">
            <PrinterIcon /> {invoice.status === "draft" ? "Print draft" : "Print invoice"}
          </a>
        </Button>
        {invoice.status === "draft" && can.issue ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending || invoice.items.length === 0}
              onClick={() => run(() => issueInvoice({ invoiceId: invoice.id, version: invoice.version }), "Invoice issued")}
            >
              <FileCheck2Icon /> Issue invoice
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                run(
                  () => discardInvoice({ invoiceId: invoice.id, version: invoice.version }),
                  "Draft discarded; charges are pending again",
                  () => router.push("/billing"),
                )
              }
            >
              <Trash2Icon /> Discard draft
            </Button>
          </div>
        ) : null}
        {invoice.status === "draft" ? (
          <p className="text-meta text-muted-foreground">Issuing numbers the invoice. After that it cannot be changed, only voided or credited.</p>
        ) : null}
        {invoice.status === "issued" && can.void ? (
          voiding ? (
            <form
              className="flex flex-col gap-2 rounded-lg border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  async () => {
                    const result = await voidInvoice({ invoiceId: invoice.id, reason, version: invoice.version, reissue });
                    if (result.ok && result.data.replacement) router.push(`/billing/invoices/${result.data.replacement.id}`);
                    return result;
                  },
                  "Invoice voided",
                  () => setVoiding(false),
                );
              }}
            >
              <Label htmlFor="void-reason">Reason for voiding</Label>
              <Input id="void-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
              <label className="flex items-center gap-2 text-table">
                <Checkbox checked={reissue} onCheckedChange={(v) => setReissue(v === true)} /> Put the charges on a new draft to correct and reissue
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="destructive" disabled={pending || reason.trim().length < 3}>
                  Void invoice
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setVoiding(false)}>
                  Keep
                </Button>
              </div>
              <p className="text-meta text-muted-foreground">
                Refund any payment first; deposit applied returns to the patient&apos;s account. An invoice with a credit note is corrected with another credit
                note, not a void. Voiding is recorded with your name and the reason.
              </p>
            </form>
          ) : (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setVoiding(true)}>
              <BanIcon /> Void…
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function Lines({ invoice, canEdit }: { invoice: InvoiceWithSettlement; canEdit: boolean }) {
  const { pending, run } = useAction();
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Lines</CardTitle>
        <span className="ml-auto text-meta text-muted-foreground">Prices as charged; discounts per line</span>
      </CardHeader>
      <CardContent className="px-0">
        {invoice.items.length === 0 ? (
          <p className="px-4 pb-4 text-body text-muted-foreground">No lines. Remove the draft, or add charges from the patient&apos;s billing page.</p>
        ) : null}
        {invoice.items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {canEdit ? <TableHead className="w-8" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <span className="font-medium">{line.description}</span>
                    <span className="block text-meta text-muted-foreground">{CATEGORY_LABEL[line.category]}</span>
                  </TableCell>
                  <TableCell>{clinicalDate(line.serviceDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{peso(line.unitPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.discountAmount ? `−${peso(line.discountAmount)}` : "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{peso(line.netAmount)}</TableCell>
                  {canEdit ? (
                    <TableCell>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${line.description}`}
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => removeLine({ invoiceId: invoice.id, lineId: line.id, version: invoice.version }),
                            "Line removed; the charge is pending again",
                          )
                        }
                      >
                        <XIcon />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Discounts({ invoice, rules, canEdit }: { invoice: InvoiceWithSettlement; rules: DiscountRule[]; canEdit: boolean }) {
  const { pending, run } = useAction();
  const [ruleId, setRuleId] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [note, setNote] = React.useState("");
  const rule = rules.find((r) => r.id === ruleId);
  const available = rules.filter((r) => !invoice.discounts.some((d) => d.ruleId === r.id));
  if (!canEdit && invoice.discounts.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <BadgePercentIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Discounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {invoice.discounts.length === 0 ? <p className="text-body text-muted-foreground">None.</p> : null}
        <ul className="flex flex-col gap-2">
          {invoice.discounts.map((d) => (
            <li key={d.id} className="flex items-start gap-2 text-body">
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {d.ruleName} ({percent(d.rateBp)})
                </span>
                {d.evidenceIdMasked ? <span className="block text-meta text-muted-foreground">ID {d.evidenceIdMasked}</span> : null}
              </span>
              <span className="tabular-nums">−{peso(d.amount)}</span>
              {canEdit ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${d.ruleName}`}
                  disabled={pending}
                  onClick={() => run(() => removeDiscount({ invoiceId: invoice.id, lineId: d.id, version: invoice.version }), "Discount removed")}
                >
                  <XIcon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit && available.length ? (
          <form
            className="flex flex-col gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!rule) return;
              run(
                () =>
                  applyDiscount({
                    invoiceId: invoice.id,
                    ruleId: rule.id,
                    evidenceIdNumber: evidence.trim() || undefined,
                    evidenceNote: note.trim() || undefined,
                    version: invoice.version,
                  }),
                `${rule.name} applied`,
                () => {
                  setRuleId("");
                  setEvidence("");
                  setNote("");
                },
              );
            }}
          >
            <Label htmlFor="discount-rule">Apply a discount</Label>
            <NativeSelect id="discount-rule" value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
              <option value="">Choose…</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {percent(r.rateBp)}
                  {r.categories.length ? ` on ${r.categories.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(", ")}` : ""}
                </option>
              ))}
            </NativeSelect>
            {rule?.requiresEvidence ? (
              <>
                <Label htmlFor="discount-evidence">ID number (required{rule.statutory ? " for a statutory discount" : ""})</Label>
                <Input
                  id="discount-evidence"
                  value={evidence}
                  maxLength={40}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="e.g. OSCA or PWD ID number"
                  required
                />
                <Input
                  aria-label="Evidence note"
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional), e.g. ID seen, photocopy on file"
                />
              </>
            ) : null}
            <Button type="submit" size="sm" className="self-start" disabled={pending || !rule}>
              Apply
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Coverage({
  invoice,
  payers,
  canEdit,
  canFollowUp,
}: {
  invoice: InvoiceWithSettlement;
  payers: BillingPayer[];
  canEdit: boolean;
  canFollowUp: boolean;
}) {
  const { pending, run } = useAction();
  const [payerId, setPayerId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [reference, setReference] = React.useState("");
  if (!canEdit && invoice.payers.length === 0) return null;
  const centavos = parsePesos(amount);
  return (
    <Card>
      <CardHeader>
        <BuildingIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>HMO, PhilHealth and other payers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {invoice.payers.length === 0 ? <p className="text-body text-muted-foreground">The patient pays everything.</p> : null}
        <ul className="flex flex-col gap-3">
          {invoice.payers.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 text-body">
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.payerName}</span>
                  <span className="block text-meta text-muted-foreground">
                    {p.reference ? `Ref. ${p.reference} · ` : ""}
                    {COVERAGE_STATUS_LABEL[p.status]}
                    {p.settledAmount !== null ? ` ${peso(p.settledAmount)}` : ""}
                  </span>
                </span>
                <span className="tabular-nums">{peso(p.amount)}</span>
                {canEdit ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${p.payerName}`}
                    disabled={pending}
                    onClick={() => run(() => removePayer({ invoiceId: invoice.id, lineId: p.id, version: invoice.version }), "Coverage removed")}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </span>
              {canFollowUp ? <ClaimFollowUp invoiceId={invoice.id} coverage={p} /> : null}
            </li>
          ))}
        </ul>
        {canEdit && payers.length ? (
          <form
            className="grid grid-cols-2 gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!payerId || centavos === null || centavos <= 0) {
                toast.error("Choose a payer and enter the amount it covers, e.g. 300.00");
                return;
              }
              run(
                () => setPayer({ invoiceId: invoice.id, payerId, amount: centavos, reference: reference.trim() || undefined, version: invoice.version }),
                "Coverage set",
                () => {
                  setPayerId("");
                  setAmount("");
                  setReference("");
                },
              );
            }}
          >
            <Label htmlFor="payer" className="col-span-2">
              Add coverage
            </Label>
            <NativeSelect id="payer" className="col-span-2" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              <option value="">Choose a payer…</option>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            <Input aria-label="Amount covered (₱)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₱" />
            <Input
              aria-label="LOA or claim reference"
              value={reference}
              maxLength={60}
              onChange={(e) => setReference(e.target.value)}
              placeholder="LOA / reference"
            />
            <Button type="submit" size="sm" className="col-span-2 justify-self-start" disabled={pending}>
              Set coverage
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ClaimFollowUp({ invoiceId, coverage }: { invoiceId: string; coverage: InvoiceCoverage }) {
  const { pending, run } = useAction();
  const [settling, setSettling] = React.useState(false);
  const [amount, setAmount] = React.useState(pesoInput(coverage.amount));
  if (coverage.status === "settled" || coverage.status === "denied") return null;
  if (settling) {
    const centavos = parsePesos(amount);
    return (
      <span className="flex items-center gap-1.5">
        <Input aria-label="Settled amount (₱)" className="h-7 w-32" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button
          type="button"
          size="xs"
          disabled={pending || centavos === null}
          onClick={() => run(() => updateClaim({ invoiceId, coverageId: coverage.id, status: "settled", settledAmount: centavos ?? 0 }), "Marked as settled")}
        >
          <CheckIcon /> Settled
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setSettling(false)}>
          Cancel
        </Button>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {coverage.status === "pending" ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => updateClaim({ invoiceId, coverageId: coverage.id, status: "submitted" }), "Marked as submitted")}
        >
          Submitted
        </Button>
      ) : null}
      <Button type="button" size="xs" variant="outline" onClick={() => setSettling(true)}>
        Settled…
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => updateClaim({ invoiceId, coverageId: coverage.id, status: "denied" }), "Marked as denied")}
      >
        Denied
      </Button>
    </span>
  );
}

function Payments({ invoice, can }: { invoice: InvoiceWithSettlement; can: Permissions }) {
  const { pending, run } = useAction();
  const [amount, setAmount] = React.useState(pesoInput(Math.max(invoice.balance, 0)));
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [reference, setReference] = React.useState("");
  // One key per real-world payment: a retried submit is recorded once; a new key after success.
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const centavos = parsePesos(amount);

  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <WalletIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Payments</CardTitle>
        <span className="ml-auto text-body font-semibold tabular-nums">Balance {peso(invoice.balance)}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {invoice.payments.length === 0 ? <p className="px-4 text-body text-muted-foreground">No payments yet.</p> : null}
        {invoice.payments.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {can.refund ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{clinicalDateTime(p.recordedAt)}</TableCell>
                  <TableCell>
                    {p.kind === "refund" ? (
                      <Badge variant="warning">
                        <RotateCcwIcon aria-hidden /> Refund
                      </Badge>
                    ) : (
                      <a
                        href={fileHref.receipt(p.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 font-mono text-table text-primary hover:underline"
                      >
                        <PrinterIcon className="size-3.5" aria-hidden /> {p.receiptNumber}
                      </a>
                    )}
                    {p.reason ? <span className="block text-meta text-muted-foreground">{p.reason}</span> : null}
                  </TableCell>
                  <TableCell>
                    {METHOD_LABEL[p.method]}
                    {p.reference ? <span className="block text-meta text-muted-foreground">{p.reference}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.kind === "refund" ? `−${peso(p.amount)}` : peso(p.amount)}</TableCell>
                  {can.refund ? (
                    <TableCell className="text-right">{p.kind === "payment" ? <Refund payment={p} ledger={invoice.payments} /> : null}</TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {can.pay && invoice.status === "issued" && invoice.balance > 0 ? (
          <form
            className="mx-4 grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (centavos === null || centavos <= 0) {
                toast.error("Enter the amount in pesos, e.g. 450.00");
                return;
              }
              run(
                () => recordPayment({ invoiceId: invoice.id, amount: centavos, method, reference: reference.trim() || undefined, idempotencyKey: key }),
                `Payment of ${peso(centavos)} recorded`,
                () => {
                  setKey(crypto.randomUUID());
                  setReference("");
                },
              );
            }}
          >
            <Input aria-label="Amount (₱)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <NativeSelect aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </NativeSelect>
            <Input
              aria-label="Reference"
              value={reference}
              maxLength={60}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Reference (card, e-wallet…)"
            />
            <Button type="submit" size="sm" disabled={pending}>
              Record payment
            </Button>
          </form>
        ) : null}
        <p className="px-4 text-meta text-muted-foreground">
          Receipt numbers are the clinic&apos;s acknowledgement receipts. Whether they can serve as BIR official receipts must be confirmed before production
          use.
        </p>
      </CardContent>
    </Card>
  );
}

function Refund({ payment, ledger }: { payment: LedgerEntry; ledger: LedgerEntry[] }) {
  const { pending, run } = useAction();
  const left = refundableAmount(payment.id, payment.amount, ledger);
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(pesoInput(left));
  const [reason, setReason] = React.useState("");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  if (left <= 0) return <span className="text-meta text-muted-foreground">Refunded</span>;
  if (!open) {
    return (
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Refund…
      </Button>
    );
  }
  const centavos = parsePesos(amount);
  return (
    <span className="flex items-center justify-end gap-1.5">
      <Input aria-label="Refund amount (₱)" className="h-7 w-24" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Input
        aria-label="Reason for the refund"
        className="h-7 w-40"
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
      />
      <Button
        type="button"
        size="xs"
        variant="destructive"
        disabled={pending || centavos === null || reason.trim().length < 3}
        onClick={() =>
          run(
            () => refundPayment({ paymentId: payment.id, amount: centavos ?? 0, method: payment.method, reason, idempotencyKey: key }),
            "Refund recorded",
            () => {
              setKey(crypto.randomUUID());
              setOpen(false);
            },
          )
        }
      >
        Refund
      </Button>
    </span>
  );
}

/** Deposit or account credit applied to this invoice (and returned by a void), and applying more of it. */
function DepositApplied({ invoice, accountBalance, canApply }: { invoice: InvoiceWithSettlement; accountBalance: number | null; canApply: boolean }) {
  const { pending, run } = useAction();
  const available = Math.min(accountBalance ?? 0, Math.max(invoice.balance, 0));
  const [amount, setAmount] = React.useState(pesoInput(available));
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const centavos = parsePesos(amount);
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <PiggyBankIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Deposit and credit</CardTitle>
        {accountBalance !== null ? <span className="ml-auto text-meta text-muted-foreground">Patient&apos;s balance {peso(accountBalance)}</span> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {invoice.accountEntries.length ? (
          <ul className="divide-y">
            {invoice.accountEntries.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-4 py-2 text-body">
                <span className="min-w-0 flex-1">
                  {e.kind === "release" ? "Returned to the patient's account (void)" : "Applied from the patient's account"}
                  <span className="block text-meta text-muted-foreground">{clinicalDateTime(e.recordedAt)}</span>
                </span>
                <span className="tabular-nums">{e.kind === "release" ? `+${peso(e.amount)}` : `−${peso(e.amount)}`}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {canApply && invoice.status === "issued" && available > 0 ? (
          <form
            className="mx-4 flex flex-wrap items-center gap-2 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (centavos === null || centavos <= 0) {
                toast.error("Enter the amount in pesos");
                return;
              }
              run(
                () => applyDeposit({ invoiceId: invoice.id, amount: centavos, idempotencyKey: key }),
                `${peso(centavos)} applied from deposit and credit`,
                () => setKey(crypto.randomUUID()),
              );
            }}
          >
            <Label htmlFor="apply-deposit">Apply (₱, up to {peso(available)})</Label>
            <Input id="apply-deposit" className="w-32" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button type="submit" size="sm" disabled={pending}>
              Apply deposit
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Credit notes of an issued invoice, and issuing one: amounts per line (at most what is left of each), with a reason. */
function CreditNotes({ invoice, canIssue }: { invoice: InvoiceWithSettlement; canIssue: boolean }) {
  const { pending, run } = useAction();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const lines = invoice.items.map((item) => ({ item, left: creditableLeft(item, invoice.creditNotes), typed: amounts[item.id]?.trim() ?? "" }));
  const chosen = lines.filter((l) => l.typed !== "");
  const parsed = chosen.map((l) => ({ invoiceItemId: l.item.id, amount: parsePesos(l.typed), left: l.left }));
  const total = parsed.reduce((a, l) => a + (l.amount ?? 0), 0);
  const invalid = parsed.some((l) => l.amount === null || l.amount <= 0 || l.amount > l.left);

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
                  toast.error("Enter an amount for each line to credit, at most what is left of it.");
                  return;
                }
                run(
                  () =>
                    issueCreditNote({
                      invoiceId: invoice.id,
                      reason,
                      lines: parsed.map((l) => ({ invoiceItemId: l.invoiceItemId, amount: l.amount ?? 0 })),
                      idempotencyKey: key,
                    }),
                  "Credit note issued",
                  () => {
                    setKey(crypto.randomUUID());
                    setAmounts({});
                    setReason("");
                    setOpen(false);
                  },
                );
              }}
            >
              {lines.map(({ item, left }) => (
                <div key={item.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
                  <Label htmlFor={`credit-${item.id}`} className="flex flex-col items-start gap-0">
                    <span>{item.description}</span>
                    <span className="text-meta font-normal text-muted-foreground">Up to {peso(left)}</span>
                  </Label>
                  <Input
                    id={`credit-${item.id}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={left <= 0}
                    value={amounts[item.id] ?? ""}
                    onChange={(e) => setAmounts({ ...amounts, [item.id]: e.target.value })}
                  />
                </div>
              ))}
              <Label htmlFor="credit-reason">Reason</Label>
              <Input id="credit-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
              <p className="text-body font-medium tabular-nums">Total {peso(total)}</p>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending || reason.trim().length < 3 || chosen.length === 0 || invalid}>
                  Issue credit note
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
              <p className="text-meta text-muted-foreground">
                A credit note is numbered and cannot be changed. It first reduces what the patient still owes; what they already paid goes to their deposit and
                credit balance (apply it or refund it). Payer coverage is not credited here. Whether the document meets BIR requirements must be confirmed
                before production use.
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
