import { notFound, redirect } from "next/navigation";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { BillingPayer, DiscountRule, InvoiceWithSettlement, PatientAccount, PhilHealthClaimPreview } from "@/lib/api/types";
import { BillingNav } from "../../billing-nav";
import { InvoiceWorkspace } from "./invoice-workspace";
import { PhilHealthClaim } from "./philhealth-claim";

export const metadata = { title: "Invoice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const [{ invoiceId }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "billing.charge.read")) redirect("/");
  if (!UUID.test(invoiceId)) notFound();
  const invoice = await api<InvoiceWithSettlement>(`/billing/invoices/${invoiceId}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const claimable = invoice.status === "issued" && invoice.payers.some((p) => p.payerType === "philhealth");
  const [rules, payers, account, philhealth] = await Promise.all([
    api<DiscountRule[]>("/billing/discount-rules"),
    api<BillingPayer[]>("/billing/payers"),
    // Deposit and credit that can be applied to what is still owed.
    invoice.status === "issued" && invoice.balance > 0 && can(session, "billing.deposit.record")
      ? api<PatientAccount>(`/billing/patients/${invoice.patientId}/account`)
      : Promise.resolve(null),
    claimable && can(session, "philhealth.claim.submit") ? api<PhilHealthClaimPreview>(`/philhealth/claims/invoices/${invoiceId}`) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title={invoice.invoiceNumber ?? "Draft invoice"}
        description={invoice.patient ? `${invoice.patient.displayName} · ${invoice.patient.patientNumber}` : undefined}
        actions={<BillingNav canReport={can(session, "billing.report.read")} canConfigure={can(session, "billing.pricelist.manage")} />}
      />
      <InvoiceWorkspace
        invoice={invoice}
        rules={rules.filter((r) => r.status === "active")}
        payers={payers.filter((p) => p.status === "active")}
        accountBalance={account?.balance ?? null}
        can={{
          issue: can(session, "billing.invoice.issue"),
          discount: can(session, "billing.discount.apply"),
          pay: can(session, "billing.payment.record"),
          refund: can(session, "billing.refund.issue"),
          void: can(session, "billing.invoice.void"),
          deposit: can(session, "billing.deposit.record"),
          creditNote: can(session, "billing.credit-note.issue"),
        }}
        aside={philhealth ? <PhilHealthClaim preview={philhealth} canSubmit /> : null}
      />
    </>
  );
}
