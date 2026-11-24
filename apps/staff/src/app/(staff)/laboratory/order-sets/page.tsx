import { redirect } from "next/navigation";
import { StaffSettingsPage } from "@/components/settings-page";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { CodingSystem, LabOrderSet, LabPanel, LabTest, VisitType } from "@/lib/api/types";
import { OrderSetsManager } from "./order-sets-manager";

export const metadata = { title: "Order sets" };

/** The organization's laboratory order sets (migration 0155; docs/domains/laboratory.md, "Order sets"). */
export default async function OrderSetsPage() {
  const session = await getSession();
  if (!can(session, "lab.catalog.manage")) redirect("/");
  // Visit types and coding systems belong to the clinic; without access to them, diagnosis prefixes are still typed.
  const [sets, tests, panels, visitTypes, codingSystems] = await Promise.all([
    api<LabOrderSet[]>("/laboratory/order-sets", { query: { includeInactive: "true" } }),
    api<LabTest[]>("/laboratory/tests"),
    api<LabPanel[]>("/laboratory/panels"),
    can(session, "appointment.read") ? api<VisitType[]>("/clinic/visit-types").catch(() => null) : null,
    can(session, "encounter.read") ? api<CodingSystem[]>("/clinic/coding-systems").catch(() => null) : null,
  ]);
  return (
    <StaffSettingsPage
      group="Laboratory"
      title="Order sets"
      description="Tests and panels your organization orders together, and when to offer them."
      details={[
        "In a consultation, doctors can add an order set in the laboratory order form. When the assistant's order-set rule is on (Settings → Assistant), a matching set is also suggested in the consultation.",
        "A set only chooses tests: the doctor checks them and places the order. Which tests belong together is your organization's clinical decision; no guideline is built in.",
        "A set is offered for diagnoses whose code starts with one of its prefixes (in one coding system, or any), or for a visit type. A set without either is chosen by hand only.",
      ]}
    >
      <OrderSetsManager
        sets={sets}
        tests={tests}
        panels={panels}
        visitTypes={visitTypes ? visitTypes.filter((v) => v.status === "active") : null}
        codingSystems={codingSystems ? codingSystems.filter((c) => c.status === "active") : null}
      />
    </StaffSettingsPage>
  );
}
