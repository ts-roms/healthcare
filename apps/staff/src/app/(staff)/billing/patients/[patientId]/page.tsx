import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { InvoiceBadge } from "@/components/invoice-badge";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { BillingCharge, BillingService, InvoiceSummary, PatientDetail } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { BillingNav } from "../../billing-nav";
import { PatientCharges } from "./patient-charges";

export const metadata = { title: "Patient billing" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PatientBillingPage({ params }: { params: Promise<{ patientId: string }> }) {
  const [{ patientId }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "billing.charge.read")) redirect("/");
  if (!UUID.test(patientId)) notFound();
  const nav = <BillingNav canReport={can(session, "billing.report.read")} canConfigure={can(session, "billing.pricelist.manage")} />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Patient billing" actions={nav} />
        <FacilityRequired action="Charges and invoices are kept per facility." />
      </>
    );
  }
  const [charges, invoices, services, patient] = await Promise.all([
    api<BillingCharge[]>("/billing/charges", { query: { patientId } }),
    api<InvoiceSummary[]>("/billing/invoices", { query: { patientId } }),
    api<BillingService[]>("/billing/services"),
    can(session, "patient.read") ? api<PatientDetail>(`/patients/${patientId}`).catch(() => null) : Promise.resolve(null),
  ]);
  const name = patient
    ? `${patient.familyName.toUpperCase()}, ${patient.givenName}`
    : (charges[0]?.patient?.displayName ?? invoices[0]?.patient?.displayName ?? "Patient");
  const number = patient?.patientNumber ?? charges[0]?.patient?.patientNumber ?? invoices[0]?.patient?.patientNumber;
  return (
    <>
      <PageHeader title={name} description={`${number ? `${number} · ` : ""}Billing at ${facility.name}`} actions={nav} />
      <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
        <PatientCharges
          patientId={patientId}
          charges={charges.filter((c) => c.status === "pending")}
          services={services.filter((s) => s.status === "active")}
          canCapture={can(session, "billing.charge.capture")}
          canInvoice={can(session, "billing.invoice.issue")}
        />
        <Card className="py-0">
          <CardHeader className="pt-4">
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {invoices.length === 0 ? <p className="px-4 pb-4 text-body text-muted-foreground">No invoices at this facility yet.</p> : null}
            <ul className="divide-y">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <Link href={`/billing/invoices/${inv.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-accent">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{inv.invoiceNumber ?? "Draft"}</span>
                      <span className="block text-meta text-muted-foreground">{clinicalDateTime(inv.issuedAt ?? inv.createdAt)}</span>
                    </span>
                    <InvoiceBadge invoice={inv} />
                    <span className="w-20 text-right tabular-nums">{peso(inv.netTotal)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
