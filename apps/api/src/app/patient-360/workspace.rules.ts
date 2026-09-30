/**
 * The Patient 360 workspace's panels (GET /patients/:id/workspace) and the read permission each needs — the same
 * permission that gates the owning domain's own reads. A panel the caller may not read is left out (null) and listed
 * in `withheld`, never counted. Allergies, problems, medications, vitals and care plans come from the summary
 * (GET /patients/:id/summary) and the timeline slice from GET /patients/:id/timeline; they are not repeated here.
 */
export const WORKSPACE_PANELS = {
  /** Consultations in progress for the patient and today's visit at the selected facility. */
  current_encounter: ["encounter.read"],
  /** Recent consultations with their diagnoses. */
  encounter_history: ["encounter.read"],
  /** Critical results not yet acknowledged by the care team. */
  critical_results: ["lab.result.read"],
  /** Open laboratory orders with each test's status. */
  lab_orders: ["lab.order.read"],
  /** Dental radiographs and photos. */
  dental_images: ["dental.imaging.read"],
  /** Documents staff uploaded for the patient. */
  documents: ["document.read"],
  /** Referrals: open ones first, then the latest; to whom, urgency, status and the overdue flag. */
  referrals: ["encounter.read"],
  /** Procedures performed at the clinic (not dental), latest first. */
  procedures: ["encounter.read"],
  /** The latest immunizations (given, not given, reported or imported). */
  immunizations: ["immunization.read"],
  /** Past procedures and conditions, the family history state and the current social history (sensitive parts also need encounter.write). */
  history: ["history.read"],
} as const satisfies Record<string, readonly string[]>;

export type WorkspacePanel = keyof typeof WORKSPACE_PANELS;
export const WORKSPACE_PANEL_KEYS = Object.keys(WORKSPACE_PANELS) as WorkspacePanel[];

/** Bounded lists: the workspace is an overview; each panel links to the full screen. */
export const WORKSPACE_LIMITS = {
  openEncounters: 5,
  recentEncounters: 5,
  criticalResults: 10,
  labOrders: 10,
  dentalImages: 8,
  documents: 8,
  referrals: 8,
  immunizations: 8,
  procedures: 8,
  history: 5,
} as const;

export function visiblePanels(permissions: ReadonlySet<string>): { included: Set<WorkspacePanel>; withheld: WorkspacePanel[] } {
  const may = (panel: WorkspacePanel) => WORKSPACE_PANELS[panel].every((p) => permissions.has(p));
  return { included: new Set(WORKSPACE_PANEL_KEYS.filter(may)), withheld: WORKSPACE_PANEL_KEYS.filter((k) => !may(k)) };
}

/**
 * The consultation to show first: one at the selected facility by the viewer, then any at the selected facility, then
 * the viewer's elsewhere, then the latest (the input is latest first).
 */
export function orderCurrentEncounters<T extends { mine: boolean; atSelectedFacility: boolean }>(encounters: readonly T[]): T[] {
  const rank = (e: T) => (e.atSelectedFacility ? 0 : 2) + (e.mine ? 0 : 1);
  return encounters
    .map((e, index) => ({ e, index }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.index - b.index)
    .map(({ e }) => e);
}
