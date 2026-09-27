import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { BillingPayer, BillingService, DiscountRule, LabTest, PhilHealthAccreditation, VisitType } from "@/lib/api/types";
import { BillingNav } from "../billing-nav";
import { BillingSettings } from "./billing-settings";

export const metadata = { title: "Prices and discounts" };

export default async function BillingSettingsPage() {
  const session = await getSession();
  if (!can(session, "billing.charge.read")) redirect("/");
  const facility = await getSelectedFacility();
  const canAccredit = can(session, "philhealth.settings.manage") && facility !== null;
  const [services, payers, rules, prefixes, visitTypes, labTests, accreditation] = await Promise.all([
    api<BillingService[]>("/billing/services"),
    api<BillingPayer[]>("/billing/payers"),
    api<DiscountRule[]>("/billing/discount-rules"),
    api<{ invoicePrefix: string; receiptPrefix: string }>("/billing/settings"),
    // Sources for automatic capture; staff without access to them can still type the code.
    can(session, "appointment.read") ? api<VisitType[]>("/clinic/visit-types").catch(() => []) : Promise.resolve([]),
    can(session, "lab.order.read") ? api<LabTest[]>("/laboratory/tests").catch(() => []) : Promise.resolve([]),
    canAccredit
      ? api<{ accreditation: PhilHealthAccreditation | null }>(`/philhealth/facilities/${facility.id}/accreditation`).then((r) => r.accreditation)
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="Prices and discounts"
        description="Billable services and their prices, HMO and other payers, discount rules and document numbers."
        actions={<BillingNav canReport={can(session, "billing.report.read")} canConfigure={false} />}
      />
      <BillingSettings
        services={services}
        payers={payers}
        rules={rules}
        prefixes={prefixes}
        visitTypes={visitTypes.map((v) => ({ code: v.code, name: v.name }))}
        labTests={labTests.map((t) => ({ code: t.code, name: t.name }))}
        canManage={can(session, "billing.pricelist.manage")}
        philhealth={canAccredit ? { facilityId: facility.id, facilityName: facility.name, accreditation } : null}
      />
    </>
  );
}
