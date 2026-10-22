import { StaffSettingsPage, SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { CodingSystem } from "@/lib/api/types";
import { CodingSystems } from "./coding-systems";

export const metadata = { title: "Coding systems" };

/**
 * The diagnosis coding systems the organization registered (e.g. the ICD-10 edition in use): read by clinical staff,
 * changed with clinic.configure. The platform ships no code set and validates no code; a system names where codes come
 * from, and a deactivated one stops being offered for new diagnoses.
 */
export default async function CodingSystemsPage() {
  const session = await getSession();
  if (!can(session, "encounter.read")) redirect("/");
  const systems = await api<CodingSystem[]>("/clinic/coding-systems");
  return (
    <StaffSettingsPage
      group="Clinical"
      title="Coding systems"
      description="Where diagnosis codes come from, as your organization names them (for example the ICD-10 edition in use)."
      details={[
        "No code list is built in and no code is checked against one.",
        "A deactivated system is no longer offered for new diagnoses, and recorded diagnoses keep theirs.",
      ]}
    >
      <SettingsStack>
        <CodingSystems systems={systems} canConfigure={can(session, "clinic.configure")} />
      </SettingsStack>
    </StaffSettingsPage>
  );
}
