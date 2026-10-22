import { StaffSettingsPage, SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabCatalogEntry, LabPanel, LabPolicy, LabSpecimenType, LabTest, LabTestReferral, ReferenceLaboratory } from "@/lib/api/types";
import { LabCatalog } from "./lab-catalog";
import { ReferenceLabSettings } from "./reference-labs";

export const metadata = { title: "Laboratory catalog" };

export default async function CatalogPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "lab.order.read")) redirect("/");
  const [tests, departments, specimenTypes, panels, policy, referenceLabs, referrals] = await Promise.all([
    api<LabTest[]>("/laboratory/tests", { query: { includeInactive: "true" } }),
    api<LabCatalogEntry[]>("/laboratory/departments"),
    api<LabSpecimenType[]>("/laboratory/specimen-types"),
    api<LabPanel[]>("/laboratory/panels"),
    facility ? api<LabPolicy>("/laboratory/policy") : Promise.resolve(null),
    api<ReferenceLaboratory[]>("/laboratory/reference-labs", { query: { includeInactive: "true" } }),
    facility ? api<LabTestReferral[]>("/laboratory/referrals") : Promise.resolve(null),
  ]);
  return (
    <StaffSettingsPage
      group="Laboratory"
      title="Laboratory catalog"
      description="Tests, reference ranges, panels and this facility's laboratory policy."
      details={["Ranges are versioned: results keep the range they were read against."]}
    >
      <SettingsStack>
        <LabCatalog
          tests={tests}
          departments={departments}
          specimenTypes={specimenTypes}
          panels={panels}
          policy={policy}
          facilityName={facility?.name ?? null}
          canManage={can(session, "lab.catalog.manage")}
        />
        <div>
          <ReferenceLabSettings
            referenceLabs={referenceLabs}
            referrals={referrals}
            tests={tests}
            facilityName={facility?.name ?? null}
            canManage={can(session, "lab.catalog.manage")}
          />
        </div>
      </SettingsStack>
    </StaffSettingsPage>
  );
}
