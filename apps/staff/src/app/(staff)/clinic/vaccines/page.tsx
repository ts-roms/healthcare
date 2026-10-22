import { StaffSettingsPage, SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { Vaccine } from "@/lib/api/types";
import { VaccineCatalog } from "./vaccine-catalog";

export const metadata = { title: "Vaccines" };

/**
 * The organization's own vaccine catalogue (clinic.configure to change; clinical staff read it). No national vaccine
 * list, schedule or code set is built in: the organization adds the vaccines it gives, with its own codes if any.
 */
export default async function VaccinesPage() {
  const session = await getSession();
  if (!can(session, "immunization.read")) redirect("/");
  const vaccines = await api<Vaccine[]>("/immunizations/catalog", { query: { includeInactive: "true" } });
  return (
    <StaffSettingsPage
      group="Clinical"
      title="Vaccines"
      description="The vaccines your organization gives or records, as you name them."
      details={[
        "Doses in a series are for reference only: the platform does not schedule doses or say which one is due.",
        "Official schedules, registry reporting and vaccine code sets are not built in.",
      ]}
    >
      <SettingsStack>
        <VaccineCatalog vaccines={vaccines} canConfigure={can(session, "clinic.configure")} />
      </SettingsStack>
    </StaffSettingsPage>
  );
}
