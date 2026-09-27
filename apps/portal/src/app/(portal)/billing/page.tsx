import { BanIcon, CheckCircle2Icon, CircleDollarSignIcon, FileDownIcon, PiggyBankIcon, ReceiptIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import type { PortalAccount, PortalInvoice, PortalInvoiceCredits } from "@/lib/api/types";
import { fileHref } from "@/lib/files";
import { ACCOUNT_ENTRY, invoiceStatus, PAYER_STATUS, peso, totalDue } from "@/lib/billing";
import { resultDate } from "@/lib/records";

export const metadata = { title: "Bills" };

const ICON = { due: CircleDollarSignIcon, paid: CheckCircle2Icon, void: BanIcon } as const;
const TONE = { due: "text-warning-foreground", paid: "text-success-foreground", void: "text-muted-foreground" } as const;

export default async function BillsPage() {
  const [invoices, accounts] = await Promise.all([
    portalApi<Array<PortalInvoice & PortalInvoiceCredits>>("/portal/billing"),
    portalApi<PortalAccount[]>("/portal/billing/account"),
  ]);
  const due = totalDue(invoices);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Bills</h1>
        <p className="text-body text-muted-foreground">
          Your invoices from the clinic, what your HMO or PhilHealth covers, and what you have paid. Pay at the clinic&apos;s cashier; paying online is not
          available yet.
        </p>
      </div>
      {invoices.length ? (
        <p className="rounded-xl border bg-card p-4">
          <span className="block text-meta text-muted-foreground">Still to pay</span>
          <span className="text-page-lg font-semibold tabular-nums">{peso(due)}</span>
        </p>
      ) : null}
      {accounts.map((account) => (
        <section key={account.facilityName} className="rounded-xl border bg-card p-4">
          <details>
            <summary className="flex cursor-pointer list-none flex-col gap-1">
              <span className="flex items-center gap-1 text-meta text-muted-foreground">
                <PiggyBankIcon className="size-3.5" aria-hidden /> Deposit and credit at {account.facilityName}
              </span>
              <span className="text-page-lg font-semibold tabular-nums">{peso(account.balance)}</span>
              <span className="text-meta text-primary">Show history</span>
            </summary>
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t pt-3 text-body">
              {account.entries.map((e, i) => (
                <Row
                  key={i}
                  label={`${ACCOUNT_ENTRY[e.kind].label}${e.invoiceNumber ? ` ${e.invoiceNumber}` : ""}${e.creditNoteNumber ? ` ${e.creditNoteNumber}` : ""} · ${resultDate(e.recordedAt)}${e.receiptNumber ? ` · ${e.receiptNumber}` : ""}`}
                  value={`${ACCOUNT_ENTRY[e.kind].adds ? "+" : "−"}${peso(e.amount)}`}
                />
              ))}
            </dl>
            <p className="mt-2 text-meta text-muted-foreground">The cashier applies this to your bills at this clinic, or refunds it when you ask.</p>
          </details>
        </section>
      ))}
      {invoices.length === 0 ? (
        <EmptyState icon={ReceiptIcon} title="No bills yet">
          Invoices the clinic issues to you appear here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices.map((inv) => {
            const status = invoiceStatus(inv);
            const Icon = ICON[status.tone];
            return (
              <li key={inv.id} className={`rounded-xl border bg-card p-4 ${inv.status === "void" ? "opacity-70" : ""}`}>
                <details>
                  <summary className="flex cursor-pointer list-none flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{inv.invoiceNumber}</span>
                      <span className="font-semibold tabular-nums">{peso(inv.patientTotal)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-meta">
                      <span className="text-muted-foreground">{resultDate(inv.issuedAt)}</span>
                      <span className={`flex items-center gap-1 font-medium ${TONE[status.tone]}`}>
                        <Icon className="size-3.5" aria-hidden /> {status.label}
                      </span>
                    </span>
                    <span className="text-meta text-primary">Show details</span>
                  </summary>
                  <a
                    href={fileHref.invoice(inv.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-meta font-medium text-primary hover:underline"
                  >
                    <FileDownIcon className="size-3.5" aria-hidden /> Download PDF
                  </a>
                  <div className="mt-3 flex flex-col gap-3 border-t pt-3 text-body">
                    <ul className="flex flex-col gap-1">
                      {inv.items.map((item, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>
                            {item.description}
                            {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                            <span className="block text-meta text-muted-foreground">{resultDate(item.serviceDate)}</span>
                          </span>
                          <span className="tabular-nums">{peso(item.grossAmount)}</span>
                        </li>
                      ))}
                    </ul>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                      {inv.discounts.map((d) => (
                        <Row key={d.name} label={`Discount: ${d.name}`} value={`−${peso(d.amount)}`} />
                      ))}
                      {inv.payers.map((p) => (
                        <Row key={p.name} label={`${p.name} (${PAYER_STATUS[p.status]})`} value={`−${peso(p.amount)}`} />
                      ))}
                      <Row label="Your share" value={peso(inv.patientTotal)} strong />
                      {inv.payments.map((p, i) => (
                        <Row
                          key={i}
                          label={`${p.kind === "refund" ? "Refund" : "Paid"} ${resultDate(p.recordedAt)}${p.receiptNumber ? ` · ${p.receiptNumber}` : ""}`}
                          value={p.kind === "refund" ? `+${peso(p.amount)}` : `−${peso(p.amount)}`}
                        />
                      ))}
                      {inv.depositApplications.map((d, i) => (
                        <Row
                          key={`deposit-${i}`}
                          label={`${d.kind === "release" ? "Deposit returned" : "Paid from deposit"} ${resultDate(d.recordedAt)}`}
                          value={d.kind === "release" ? `+${peso(d.amount)}` : `−${peso(d.amount)}`}
                        />
                      ))}
                      {inv.creditNotes.map((c) => (
                        <Row key={c.id} label={`Credit note ${c.creditNoteNumber} · ${c.reason}`} value={`−${peso(c.amount)}`} />
                      ))}
                      {inv.status === "issued" ? <Row label="Balance" value={peso(inv.balance)} strong /> : null}
                    </dl>
                    {inv.creditNotes.length ? (
                      <ul className="flex flex-col gap-1">
                        {inv.creditNotes.map((c) => (
                          <li key={c.id}>
                            <a
                              href={fileHref.creditNote(c.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-meta font-medium text-primary hover:underline"
                            >
                              <FileDownIcon className="size-3.5" aria-hidden /> Credit note {c.creditNoteNumber} (PDF)
                            </a>
                            {c.accountCredit ? (
                              <span className="block text-meta text-muted-foreground">
                                {peso(c.accountCredit)} you had already paid is now credit on your account.
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-meta text-muted-foreground">Questions about a bill? Ask the clinic&apos;s cashier and bring your invoice number.</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </>
  );
}
