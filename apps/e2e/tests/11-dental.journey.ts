import { expect, type Locator, type Page, test } from "@playwright/test";
import { loadState, manilaDate, staffApi } from "../support/api";
import { STAFF } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Dental charting and treatment plans: the dentist starts a dental visit, charts an examination on the odontogram,
 * proposes a two-item plan, records the patient's decision, carries out the accepted item from the plan (the chart
 * changes, the item is done, billing charges it) and corrects an entry as "entered in error" without anything being
 * overwritten. A role without dental access never sees the module.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];

const patient = { id: "", name: "Dentalpat, Dora" };
const PLAN_TITLE = "Restorative phase and hygiene";
const COMPOSITE = { code: "e2e-composite", name: "Composite restoration" };
const PROPHY = { code: "e2e-prophylaxis", name: "Prophylaxis" };
const COMPOSITE_PRICE_PESOS = 1500;

let dentist: Page;

const tooth = (page: Page, fdi: string): Locator => page.getByRole("button", { name: new RegExp(`^Tooth ${fdi},`) });
const plan = (page: Page): Locator => page.getByRole("region", { name: `Treatment plan ${PLAN_TITLE}` });
const planItem = (page: Page, text: string | RegExp): Locator => plan(page).getByRole("listitem").filter({ hasText: text });
const toggle = (page: Page, group: string | RegExp, name: string | RegExp): Locator => page.getByRole("toolbar", { name: group }).getByRole("button", { name });

/** Selects a tooth and charts it with one finding on the given surfaces. */
async function chartTooth(page: Page, fdi: string, finding: string, surfaces: string[]): Promise<void> {
  await tooth(page, fdi).click();
  await toggle(page, "Findings", new RegExp(`${finding}$`)).click();
  for (const surface of surfaces) await toggle(page, `${finding} surfaces`, new RegExp(surface)).click();
}

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const created = await api.post<{ id: string }>("/patients", {
    familyName: "Dentalpat",
    givenName: "Dora",
    sex: "female",
    birthDate: "1991-07-23",
    contacts: [{ system: "mobile", value: "0917 555 0311" }],
  });
  patient.id = created.id;

  // Procedure codes are the organization's own; the composite restoration is charged per tooth treated.
  await api.post("/dental/procedure-types", { code: COMPOSITE.code, name: COMPOSITE.name, site: "surface", chartEffect: "restoration" });
  await api.post("/dental/procedure-types", { code: PROPHY.code, name: PROPHY.name, site: "mouth" });
  await api.post("/billing/services", {
    code: "dental-composite",
    name: "Composite restoration (fee)",
    category: "dental",
    sourceKind: "dental_procedure",
    sourceCode: COMPOSITE.code,
    unitPrice: COMPOSITE_PRICE_PESOS * 100,
    effectiveFrom: manilaDate(-30),
    chargeUnit: "each",
  });
  await api.post("/billing/services", {
    code: "dental-prophylaxis",
    name: "Prophylaxis (fee)",
    category: "dental",
    sourceKind: "dental_procedure",
    sourceCode: PROPHY.code,
    unitPrice: 800 * 100,
    effectiveFrom: manilaDate(-30),
    chargeUnit: "each",
  });
  await api.dispose();

  dentist = await staffPage(browser, STAFF.dentist, errors);
});

test.afterAll(async () => {
  await dentist?.context().close();
});

test("the dentist starts a dental visit for the patient", async () => {
  await dentist.goto(`/dental/patients/${patient.id}`);
  await expect(dentist.getByRole("heading", { name: new RegExp(`Dental · ${patient.name}`, "i") })).toBeVisible();
  // Charting needs a visit in progress.
  await expect(dentist.getByRole("button", { name: "Chart examination" })).toBeDisabled();
  await dentist.getByLabel("Chief complaint").fill("Pain on chewing, lower left side");
  await dentist.getByRole("button", { name: "Start dental visit" }).click();
  await toast(dentist, "Dental visit started");
  await expect(dentist.getByText(/Dental visit in progress since/)).toBeVisible();
  await expect(dentist.getByRole("button", { name: "Chart examination" })).toBeEnabled();
});

test("an examination is charted on the odontogram, in the facility's notation, and shows in the chart and the tooth's history", async () => {
  await expect(dentist.getByText(/FDI notation/i)).toBeVisible();
  await dentist.getByRole("button", { name: "Chart examination" }).click();

  await chartTooth(dentist, "16", "Caries", ["Mesial", "Occlusal"]);
  await dentist.getByRole("textbox", { name: "Note", exact: true }).fill("Deep, sensitive to cold");
  await chartTooth(dentist, "36", "Missing", []);
  await expect(dentist.getByText("2 teeth changed.")).toBeVisible();

  await dentist.getByLabel("Oral hygiene").selectOption({ label: "Fair" });
  await dentist.getByLabel("Examination notes").fill("Generalised plaque; no soft-tissue lesions");
  await dentist.getByRole("button", { name: "Record examination" }).click();
  await toast(dentist, "Examination recorded: 2 teeth charted");

  // The chart shows the current state of each tooth.
  await expect(tooth(dentist, "16")).toHaveAccessibleName(/Caries/);
  await expect(tooth(dentist, "36")).toHaveAccessibleName(/Missing/);
  const examinations = dentist.getByRole("list", { name: "Examinations" });
  await expect(examinations.locator(":scope > li")).toHaveCount(1);
  await expect(examinations).toContainText("Oral hygiene: Fair");
  await expect(examinations).toContainText("Generalised plaque");

  // The tooth's history lists the examination it came from.
  await tooth(dentist, "16").click();
  await expect(dentist.getByText(/From an examination/)).toBeVisible();
  await dentist.getByRole("button", { name: "History" }).click();
  const history = dentist.getByRole("list", { name: "History of tooth 16" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history).toContainText("Examination");
  await expect(history).toContainText("Caries");
});

test("a treatment plan with two items is proposed, with a fee estimate", async () => {
  await dentist.getByRole("button", { name: "New plan" }).click();
  await dentist.locator("#plan-title").fill(PLAN_TITLE);

  await dentist.locator("#plan-item-0-procedure").selectOption({ label: `${COMPOSITE.name} (tooth surfaces)` });
  await dentist.locator("#plan-item-0-tooth").fill("16");
  await toggle(dentist, "Surfaces", /Mesial/).click();
  await toggle(dentist, "Surfaces", /Occlusal/).click();
  await dentist.locator("#plan-item-0-note").fill("Replace after caries removal");

  await dentist.getByRole("button", { name: "Add item" }).click();
  await dentist.locator("#plan-item-1-phase").selectOption({ label: "2" });
  await dentist.locator("#plan-item-1-procedure").selectOption({ label: `${PROPHY.name} (whole mouth)` });
  await dentist.getByRole("button", { name: "Propose plan" }).click();
  await toast(dentist, "Treatment plan proposed");

  await expect(plan(dentist)).toBeVisible();
  await expect(plan(dentist)).toContainText("Proposed — awaiting the patient's decision");
  await expect(planItem(dentist, COMPOSITE.name)).toContainText("16 MO");
  await expect(planItem(dentist, PROPHY.name)).toContainText("Phase 2");

  // Billing's listed prices make the estimate: 1,500 + 800 awaiting the patient's decision.
  const estimate = plan(dentist).getByLabel("Fee estimate");
  await expect(estimate).toBeVisible();
  await expect(estimate).toContainText("Awaiting decision");
  await expect(estimate).toContainText("2,300");
  await expect(planItem(dentist, COMPOSITE.name)).toContainText("1,500");
});

test("the patient's decision is recorded item by item: one accepted, one declined", async () => {
  await plan(dentist)
    .getByRole("checkbox", { name: `Patient accepts ${PROPHY.name}` })
    .click();
  const decide = plan(dentist).getByRole("button", { name: "Record decision" });
  await expect(decide).toBeDisabled(); // a decision needs a note
  await plan(dentist)
    .getByLabel(/Patient's decision/)
    .fill("Fees explained; accepts the filling, declines the cleaning for now");
  await decide.click();
  await toast(dentist, "Decision recorded");

  await expect(plan(dentist)).toContainText("Accepted");
  await expect(planItem(dentist, COMPOSITE.name).getByText("Accepted", { exact: true })).toBeVisible();
  await expect(planItem(dentist, PROPHY.name).getByText("Declined", { exact: true })).toBeVisible();
  await expect(plan(dentist)).toContainText("declines the cleaning for now");
  // The estimate the patient decided on is kept with each decided item.
  await expect(planItem(dentist, COMPOSITE.name)).toContainText("Estimate at decision");
});

test("the accepted item is carried out as a procedure: the plan item is done and the chart changes", async () => {
  await dentist.locator("#procedure-plan-item").selectOption({ label: `${PLAN_TITLE} · phase 1 · ${COMPOSITE.name} — 16 MO` });
  await expect(dentist.locator("#procedure-tooth")).toHaveValue("16");
  await dentist.locator("#procedure-notes").fill("Composite A2, local anaesthesia");
  await dentist.getByRole("button", { name: "Record procedure" }).click();
  await toast(dentist, /Composite restoration .* recorded — confirm the supplies used/);

  const procedures = dentist.getByRole("list", { name: "Procedures performed" });
  await expect(procedures.getByRole("listitem").first()).toContainText(`${COMPOSITE.name} — 16 MO`);
  await expect(procedures.getByRole("listitem").first()).toContainText("from plan");

  // The plan item is done and the whole plan completed (the declined item is not work to do).
  await expect(planItem(dentist, COMPOSITE.name).getByText("Done", { exact: true })).toBeVisible();
  await expect(plan(dentist).getByText("Completed", { exact: true })).toBeVisible();

  // The restoration replaced the caries on the treated surfaces; the earlier examination is still on record.
  await expect(tooth(dentist, "16")).toHaveAccessibleName(/Restoration/);
  await expect(tooth(dentist, "16")).not.toHaveAccessibleName(/Caries/);
  await tooth(dentist, "16").click();
  await expect(dentist.getByText(/From a procedure/)).toBeVisible();
  await dentist.getByRole("button", { name: "History" }).click();
  const history = dentist.getByRole("list", { name: "History of tooth 16" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history).toContainText("Procedure");
  await expect(history).toContainText("Caries");
});

test("billing charges the procedure from its code", async () => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const charges = await api.get<unknown>(`/billing/charges?patientId=${patient.id}`);
  await api.dispose();
  expect(JSON.stringify(charges)).toContain("Composite restoration");
});

test("a mistaken entry is marked entered in error with a reason: it stays on record and leaves the current chart", async () => {
  await dentist.goto(`/dental/patients/${patient.id}`);

  await dentist.getByRole("button", { name: "Chart examination" }).click();
  await chartTooth(dentist, "11", "Watch", []);
  await dentist.getByRole("button", { name: "Record examination" }).click();
  await toast(dentist, "Examination recorded: 1 tooth charted");
  await expect(tooth(dentist, "11")).toHaveAccessibleName(/Watch/);

  const examinations = dentist.getByRole("list", { name: "Examinations" });
  await expect(examinations.locator(":scope > li")).toHaveCount(2);
  const newest = examinations.locator(":scope > li").first();
  await newest.getByRole("button", { name: "Entered in error…" }).click();
  const confirm = newest.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeDisabled(); // a reason is required
  await newest.getByLabel("Why is this examination in error?").fill("Wrong tooth recorded");
  await confirm.click();
  await toast(dentist, "Examination marked entered in error");

  // Nothing is deleted: both examinations are listed, the corrected one marked; the current chart is derived without it.
  await expect(examinations.locator(":scope > li")).toHaveCount(2);
  await expect(examinations.locator(":scope > li").first()).toContainText("Entered in error");
  await expect(tooth(dentist, "11")).toHaveAccessibleName(/not charted/);
  await expect(tooth(dentist, "16")).toHaveAccessibleName(/Restoration/);

  // The tooth's history still shows the corrected entry, marked.
  await tooth(dentist, "11").click();
  await dentist.getByRole("button", { name: "History" }).click();
  const history = dentist.getByRole("list", { name: "History of tooth 11" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history).toContainText("Entered in error");
});

test("a role without dental access never sees the dental module, and the API refuses it", async ({ browser }) => {
  const cashier = await staffPage(browser, STAFF.cashier, errors);
  await cashier.goto("/");
  await expect(cashier.getByRole("link", { name: "Billing", exact: true }).first()).toBeVisible();
  await expect(cashier.getByRole("link", { name: "Dental", exact: true })).toHaveCount(0);

  // The route sends them away rather than showing a record.
  await cashier.goto(`/dental/patients/${patient.id}`);
  await cashier.waitForURL((url) => !url.pathname.startsWith("/dental"));
  await expect(cashier.getByText("Dental · ")).toHaveCount(0);
  await cashier.context().close();

  const api = await staffApi(STAFF.cashier, state.facilityId);
  await expect(api.get(`/dental/patients/${patient.id}`)).rejects.toThrow(/→ 403/);
  await api.dispose();

  expect(errors).toEqual([]);
});
