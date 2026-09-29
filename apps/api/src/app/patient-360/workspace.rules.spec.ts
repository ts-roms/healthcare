import { orderCurrentEncounters, visiblePanels, WORKSPACE_PANEL_KEYS } from "./workspace.rules";

describe("Patient 360 workspace rules", () => {
  it("includes a panel only with every permission it needs and lists the rest as withheld", () => {
    const cashier = visiblePanels(new Set(["patient.read", "billing.charge.read"]));
    expect([...cashier.included]).toEqual([]);
    expect(cashier.withheld).toEqual(WORKSPACE_PANEL_KEYS);

    const physician = visiblePanels(new Set(["patient.read", "encounter.read", "lab.result.read", "lab.order.read", "document.read"]));
    expect([...physician.included]).toEqual(["current_encounter", "encounter_history", "critical_results", "lab_orders", "documents"]);
    expect(physician.withheld).toEqual(["dental_images"]);

    const medtech = visiblePanels(new Set(["lab.result.read", "lab.order.read"]));
    expect([...medtech.included]).toEqual(["critical_results", "lab_orders"]);
  });

  it("puts the viewer's consultation at the selected facility first, keeping latest-first otherwise", () => {
    const e = (id: string, mine: boolean, atSelectedFacility: boolean) => ({ id, mine, atSelectedFacility });
    const ordered = orderCurrentEncounters([
      e("elsewhere-mine", true, false),
      e("here-other", false, true),
      e("elsewhere", false, false),
      e("here-mine", true, true),
    ]);
    expect(ordered.map((x) => x.id)).toEqual(["here-mine", "here-other", "elsewhere-mine", "elsewhere"]);
    expect(orderCurrentEncounters([])).toEqual([]);
  });
});
