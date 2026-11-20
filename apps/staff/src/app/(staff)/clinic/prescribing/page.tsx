import { redirect } from "next/navigation";
import { StaffSettingsPage } from "@/components/settings-page";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { MedicineSetting } from "@/lib/api/types";
import { MedicineSettingsManager } from "./medicine-settings-manager";

export const metadata = { title: "Prescribing checks" };

/** The organization's own medicine settings for the assistant's prescribing rules (migration 0156; docs/domains/prescription.md). */
export default async function PrescribingSettingsPage() {
  const session = await getSession();
  if (!can(session, "clinic.configure")) redirect("/");
  const medicines = await api<MedicineSetting[]>("/prescribing/medicines", { query: { includeInactive: "true" } });
  return (
    <StaffSettingsPage
      group="Clinical"
      title="Prescribing checks"
      description="Your organization's own classes, maximum daily doses and checks per medicine, used to check prescriptions before they are issued."
      details={[
        "When the assistant's prescribing rules are on (Settings → Assistant), a prescription is checked when the doctor selects Issue: the same medicine or a medicine of the same class already current, a daily dose above the maximum set here, and the checks you ask for. The doctor sees the suggestions and can still issue.",
        "Medicines are matched by the words of their names: a setting for “metformin” also covers “Metformin HCl 500 mg”. Doses are compared only in the unit you give; no unit is converted and no dose by body weight is checked.",
        "Every value is your organization's own decision, to be checked by your physicians or pharmacist. No dose, class or interaction is built in.",
      ]}
    >
      <MedicineSettingsManager medicines={medicines} />
    </StaffSettingsPage>
  );
}
