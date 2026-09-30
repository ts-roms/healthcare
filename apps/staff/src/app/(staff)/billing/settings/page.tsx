import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type {
  BillingPackage,
  BillingPayer,
  BillingService,
  BillingSettingsFull,
  ProcedureDefinition,
  DentalSettings,
  DiscountRule,
  LabTest,
  PhilHealthAccreditation,
  TaxProfile,
  VisitType,
  YakapParticipation,
} from "@/lib/api/types";
import { BillingNav } from "../billing-nav";
import { BillingSettings } from "./billing-settings";

export const metadata = { title: "Prices and discounts" };

export default async function BillingSettingsPage() {
  const session = await getSession();
  if (!can(session, "billing.charge.read")) redirect("/");
  const facility = await getSelectedFacility();
  const canAccredit = can(session, "philhealth.settings.manage") && facility !== null;
  const [services, payers, rules, settings, taxProfile, packages, visitTypes, labTests, dental, accreditation, yakap, procedures] = await Promise.all([
    api<BillingService[]>("/billing/services"),
    api<BillingPayer[]>("/billing/payers"),
    api<DiscountRule[]>("/billing/discount-rules"),
    api<BillingSettingsFull>("/billing/settings"),
    api<TaxProfile>("/billing/tax-profile"),
    api<BillingPackage[]>("/billing/packages"),
    // Sources for automatic capture; staff without access to them can still type the code.
    can(session, "appointment.read") ? api<VisitType[]>("/clinic/visit-types").catch(() => []) : Promise.resolve([]),
    can(session, "lab.order.read") ? api<LabTest[]>("/laboratory/tests").catch(() => []) : Promise.resolve([]),
    can(session, "dental.record.read") ? api<DentalSettings>("/dental/settings").catch(() => null) : Promise.resolve(null),
    canAccredit
      ? api<{ accreditation: PhilHealthAccreditation | null }>(`/philhealth/facilities/${facility.id}/accreditation`).then((r) => r.accreditation)
      : Promise.resolve(null),
    canAccredit
      ? api<{ participation: YakapParticipation | null }>(`/philhealth/facilities/${facility.id}/yakap-participation`).then((r) => r.participation)
      : Promise.resolve(null),
    can(session, "encounter.read") ? api<ProcedureDefinition[]>("/clinic/procedure-definitions").catch(() => []) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title="Prices and discounts"
        description="Billable services and their prices, packages, HMO and other payers, discount rules, tax settings and document numbers."
        actions={<BillingNav canReport={can(session, "billing.report.read")} canConfigure={false} />}
      />
      <BillingSettings
        services={services.filter((s) => !s.isPackage)}
        payers={payers}
        rules={rules}
        settings={settings}
        taxProfile={taxProfile}
        packages={packages}
        visitTypes={visitTypes.map((v) => ({ code: v.code, name: v.name }))}
        labTests={labTests.map((t) => ({ code: t.code, name: t.name }))}
        dentalProcedures={(dental?.procedureTypes ?? []).map((t) => ({ code: t.code, name: t.name }))}
        clinicProcedures={procedures.map((p) => ({ code: p.code, name: p.name }))}
        canManage={can(session, "billing.pricelist.manage")}
        philhealth={canAccredit ? { facilityId: facility.id, facilityName: facility.name, accreditation } : null}
        yakap={canAccredit ? { facilityId: facility.id, facilityName: facility.name, participation: yakap } : null}
      />
    </>
  );
}
