"use client";

import Link from "next/link";
import { EncounterTimeline } from "@healthcare/ui/healthcare";
import type { WorkspaceEncounter } from "@/lib/api/types";
import { toEncounterHistory } from "@/lib/patient-workspace";

/** Recent consultations, each opening the encounter workspace (a client component: it passes a link renderer). */
export function EncounterHistory({ encounters, currentId }: { encounters: WorkspaceEncounter[]; currentId?: string }) {
  return (
    <EncounterTimeline encounters={toEncounterHistory(encounters)} selectedId={currentId} href={(e) => `/clinic/encounters/${e.id}`} linkComponent={Link} />
  );
}
