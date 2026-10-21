import { expect, type Locator, type Page, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { STAFF } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Route templates (migration 0116): the administrator defines "Annual check-up" (triage → laboratory → X-ray) and offers
 * it first for a visit type; at triage the nurse finds it pre-selected and the stops filled in; the patient is sent on
 * stop by stop; on the board a template fills in a re-plan; editing the template never changes a route already planned.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];

const names = { triage: "Template Triage", lab: "Template Lab", xray: "Template X-ray" };
const patient = { id: "", family: "Templatepatient" };
let ticket = "";
let visitTypeName = "Template check-up";

let admin: Page;
let nurse: Page;

/** Picks a stop by its service point's name in the editor's list (options read "Name · Kind"). */
async function chooseStop(scope: Locator, name: string): Promise<void> {
  const select = scope.locator("#route-template-stop");
  const value = await select.locator("option", { hasText: name }).first().getAttribute("value");
  await select.selectOption({ value: value! });
}

const card = (page: Page): Locator => page.getByRole("button", { name: new RegExp(`A-\\d+.*${patient.family}`, "i") });
const panel = (page: Page): Locator => page.getByRole("complementary", { name: new RegExp(`^Ticket ${ticket}$`) });

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  await api.post("/clinic/visit-types", { code: "template-checkup", name: visitTypeName, defaultDurationMinutes: 30, requiresTriage: true });
  for (const [code, name, kind, location] of [
    ["tpl-triage", names.triage, "consultation", "Triage 1"],
    ["tpl-lab", names.lab, "other", "Laboratory"],
    ["tpl-xray", names.xray, "imaging", "X-ray room"],
  ] as const) {
    await api.post("/clinic/service-points", { facilityId: state.facilityId, code, name, kind, location });
  }
  patient.id = (await api.post<{ id: string }>("/patients", { familyName: patient.family, givenName: "Tess", sex: "female", birthDate: "1982-05-17" })).id;
  await api.dispose();
  admin = await staffPage(browser, STAFF.admin, errors);
  nurse = await staffPage(browser, STAFF.nurse, errors);
});

test.afterAll(async () => {
  await admin?.context().close();
  await nurse?.context().close();
});

test("the administrator defines a route template and offers it first for a visit type", async () => {
  await admin.goto("/admin/service-points");
  const form = admin.getByRole("form", { name: "Add a route template" });
  await form.locator("#route-template-code").fill("annual-checkup");
  await form.locator("#route-template-name").fill("Annual check-up");
  for (const name of [names.triage, names.lab, names.xray]) {
    await chooseStop(form, name);
    await form.getByRole("button", { name: "Add stop" }).click();
  }
  await form.getByLabel(visitTypeName).check();
  await form.getByRole("button", { name: "Add route template" }).click();
  await toast(admin, "Annual check-up added");
  const row = admin.getByRole("list", { name: "Route templates" }).getByRole("listitem").filter({ hasText: "Annual check-up" });
  await expect(row).toContainText(`${names.triage} → ${names.lab} → ${names.xray}`);
  await expect(row).toContainText(`Offered first for: ${visitTypeName}`);
});

test("a stop cannot follow itself in a template", async () => {
  await admin.goto("/admin/service-points");
  const form = admin.getByRole("form", { name: "Add a route template" });
  await chooseStop(form, names.lab);
  await form.getByRole("button", { name: "Add stop" }).click();
  // The editor does not offer the stop just added, so the same one cannot be chosen twice in a row.
  await expect(form.locator("#route-template-stop option", { hasText: names.lab })).toHaveCount(0);
});

test("at triage the template is offered for the visit type, with the stops filled in", async ({ browser }) => {
  const desk = await staffPage(browser, STAFF.desk, errors);
  await desk.goto(`/queue/walk-in?patientId=${patient.id}`);
  await desk.locator("#visitType").selectOption({ label: visitTypeName });
  await desk.locator("#complaint").fill("Yearly check-up");
  await desk.getByRole("button", { name: "Check in" }).click();
  ticket = /ticket (A-\d{3})/.exec(await toast(desk, /Checked in — ticket A-\d{3}/))![1]!;
  await desk.context().close();

  await nurse.goto("/queue");
  await card(nurse).click();
  await panel(nurse).getByRole("link", { name: "Triage & vitals" }).click();
  await nurse.waitForURL(/\/queue\/visits\/[0-9a-f-]{36}\/triage$/);
  await expect(nurse.locator("#routeTemplate")).toHaveValue(/.+/);
  await expect(nurse.locator("#servicePointId")).toHaveValue(/.+/);
  await expect(nurse.getByRole("list", { name: "Planned stops" })).toContainText(names.lab);
  await expect(nurse.getByRole("list", { name: "Planned stops" })).toContainText(names.xray);
  // The nurse can still change what the template filled in: drop the X-ray stop.
  await nurse.getByRole("button", { name: `Remove ${names.xray} from the route` }).click();
  await expect(nurse.getByRole("list", { name: "Planned stops" })).not.toContainText(names.xray);
  // …and apply the template again to get it back.
  await nurse.locator("#routeTemplate").selectOption({ index: 1 });
  await expect(nurse.getByRole("list", { name: "Planned stops" })).toContainText(names.xray);

  await nurse.getByLabel("Chief complaint").fill("Yearly check-up");
  await nurse.getByRole("button", { name: "Complete triage" }).click();
  await toast(nurse, new RegExp(`${ticket}: triage complete, ready for provider · sent to ${names.triage}, then ${names.lab} → ${names.xray}`));
  await nurse.waitForURL(/\/queue$/);
});

test("the patient is sent on stop by stop along the planned route", async () => {
  await nurse.goto("/queue");
  await card(nurse).click();
  await expect(panel(nurse).getByRole("list", { name: "Route" })).toContainText(names.triage);
  for (const next of [names.lab, names.xray]) {
    await panel(nurse).getByRole("button", { name: "Done here, send on" }).click();
    await panel(nurse).getByRole("button", { name: "Send on", exact: true }).click();
    await toast(nurse, `${ticket} sent on`);
    await expect(panel(nurse).getByText(next).first()).toBeVisible();
  }
});

test("on the board a template fills in a new plan, and editing a template leaves a planned route alone", async () => {
  // A second visit: planned from the board with the template instead of stop by stop.
  const api = await staffApi(STAFF.admin, state.facilityId);
  const second = await api.post<{ id: string }>("/patients", { familyName: "Templatesecond", givenName: "Sol", sex: "male", birthDate: "1975-02-02" });
  const types = await api.get<Array<{ id: string; name: string }>>("/clinic/visit-types");
  const visitType = types.find((t) => t.name === visitTypeName)!;
  const walkIn = await api.post<{ id: string; ticket: string }>("/queue/walk-ins", { patientId: second.id, visitTypeId: visitType.id });
  await api.post(`/queue/visits/${walkIn.id}/triage`, {
    chiefComplaint: "Check-up",
    priority: "routine",
    riskFlags: [],
    vitals: { temperatureC: 36.8 },
    completeTriage: true,
    servicePointId: (await api.get<Array<{ id: string; name: string }>>(`/clinic/service-points?facilityId=${state.facilityId}`)).find(
      (s) => s.name === names.triage,
    )!.id,
  });
  await api.dispose();

  await nurse.goto("/queue");
  await nurse.getByRole("button", { name: /A-\d+.*Templatesecond/i }).click();
  const aside = nurse.getByRole("complementary", { name: new RegExp(`^Ticket ${walkIn.ticket}$`) });
  await aside.getByRole("button", { name: "Plan route…" }).click();
  await aside.locator("#route-plan-template").selectOption({ index: 1 });
  // The patient is already at the Triage Room: only the stops after it are planned.
  await expect(aside.getByRole("list", { name: "Planned stops" })).toContainText(names.lab);
  await expect(aside.getByRole("list", { name: "Planned stops" })).toContainText(names.xray);
  await expect(aside.getByRole("list", { name: "Planned stops" })).not.toContainText(names.triage);
  await aside.getByRole("button", { name: "Save route" }).click();
  await toast(nurse, `${walkIn.ticket}: route saved`);

  // The facility edits the template: the route already planned for the visit keeps its stops.
  await admin.goto("/admin/service-points");
  const row = admin.getByRole("list", { name: "Route templates" }).getByRole("listitem").filter({ hasText: "Annual check-up" });
  await row.getByRole("button", { name: "Edit" }).click();
  const form = admin.getByRole("form", { name: "Edit route template" });
  await form.getByRole("button", { name: `Remove ${names.xray} from the route` }).click();
  await form.getByRole("button", { name: "Save changes" }).click();
  await toast(admin, "Annual check-up updated");
  await expect(row).not.toContainText(names.xray);

  await nurse.reload();
  await nurse.getByRole("button", { name: /A-\d+.*Templatesecond/i }).click();
  await expect(aside.getByRole("list", { name: "Route" })).toContainText(names.xray);
  expect(errors).toEqual([]);
});
