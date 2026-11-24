import { ModulePage } from "@/components/module-page";
import { SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { AssistantSuggestions } from "@/components/assistant-suggestions";
import { FacilityRequired } from "@/components/facility-required";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabInstrument, LabQcBoard, LabQcMaterial, LabTest } from "@/lib/api/types";
import { hasSomethingToShow, loadSuggestions } from "@/lib/assistant-suggestions";
import { QcWorkspace } from "./qc-workspace";

export const metadata = { title: "Quality control" };

export default async function QualityControlPage({ searchParams }: { searchParams: Promise<{ instrument?: string; test?: string }> }) {
  const [session, facility, query] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  // A series to open first, from a link (the assistant's QC suggestion): only ids, checked against the board.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const chart =
    query.instrument && query.test && uuid.test(query.instrument) && uuid.test(query.test) ? { instrumentId: query.instrument, testId: query.test } : null;
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <ModulePage title="Quality control">
        <FacilityRequired action="QC runs belong to a facility's instruments." />
      </ModulePage>
    );
  }
  const [board, materials, instruments, tests, suggestions] = await Promise.all([
    api<LabQcBoard>("/laboratory/qc/status"),
    api<LabQcMaterial[]>("/laboratory/qc/materials"),
    api<LabInstrument[]>("/laboratory/instruments"),
    api<LabTest[]>("/laboratory/tests"),
    // QC drift and shift, and rejection rates for quality managers (docs/domains/assistant.md).
    loadSuggestions(session, "laboratory-quality"),
  ]);
  return (
    <ModulePage
      title="Quality control"
      description={`Internal QC at ${facility.name}: control values against each lot's target, evaluated with this facility's Westgard rules.`}
      details={["Decision support for the laboratory's review."]}
    >
      <SettingsStack>
        {hasSomethingToShow(suggestions) ? <AssistantSuggestions surface="laboratory-quality" suggestions={suggestions} /> : null}
        <QcWorkspace
          key={chart ? `${chart.instrumentId}:${chart.testId}` : "board"}
          chart={chart}
          board={board}
          materials={materials}
          instruments={instruments}
          tests={tests.filter((t) => t.resultType === "numeric")}
          canEnter={can(session, "lab.qc.enter")}
          canManage={can(session, "lab.qc.manage")}
        />
      </SettingsStack>
    </ModulePage>
  );
}
