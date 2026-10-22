import { ModulePage } from "@/components/module-page";
import { SettingsStack } from "@/components/settings-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { LiveLabRefresh } from "@/components/live-queue";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabCriticalAlert } from "@/lib/api/types";
import { CriticalList } from "./critical-list";

export const metadata = { title: "Critical results" };

export default async function CriticalResultsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [session, facility, params] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "lab.result.read")) redirect("/");
  if (!facility) {
    return (
      <ModulePage title="Critical results">
        <FacilityRequired action="Critical results are tracked per facility laboratory." />
      </ModulePage>
    );
  }
  const showAcknowledged = params.show === "acknowledged";
  const alerts = await api<LabCriticalAlert[]>("/laboratory/critical-results", { query: { status: showAcknowledged ? "acknowledged" : "unacknowledged" } });
  return (
    <ModulePage
      title="Critical results"
      description={`${facility.name} · document who was told, then the ordering side acknowledges`}
      actions={
        <span className="flex items-center gap-3">
          {can(session, "lab.order.read") ? <LiveLabRefresh /> : null}
          <Link href={showAcknowledged ? "/laboratory/critical" : "/laboratory/critical?show=acknowledged"} className="text-meta text-primary hover:underline">
            {showAcknowledged ? "Show open" : "Show acknowledged"}
          </Link>
        </span>
      }
    >
      <SettingsStack>
        <CriticalList alerts={alerts} canCommunicate={can(session, "lab.critical.manage")} acknowledged={showAcknowledged} />
      </SettingsStack>
    </ModulePage>
  );
}
