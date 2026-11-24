import { expect, type Locator, type Page, test } from "@playwright/test";
import { manilaDate, type StaffApi, staffApi } from "../support/api";
import { STAFF, STAFF_PASSWORD } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * The Assistant section's Suggestions pages (docs/domains/assistant.md, "Assistant section", ADR-0019): with the stock
 * rule turned on, an inventory officer opens **Assistant → Suggestions** from the sidebar and finds the suggestion under
 * Stock, where each check they may read is listed with its state; dismissing it there hides it on the inventory screen
 * too, for them only. A cashier, who reads no stock, is offered no Stock area and never sees the stock rule or its
 * findings. Turned off again, the area says nothing is checked.
 */
test.describe.configure({ mode: "serial" });

const errors: string[] = [];

const RULE_ID = "inventory.days-of-cover";
const RULE_TITLE = "Stock may run out before a delivery arrives";
/** The seeded clinic, which `staffPage` selects in the top bar (support/prepare-database.ts). */
const FACILITY = "E2E Main Clinic";
const ITEM = "Sterile gauze pad 4x4";
const SUGGESTION = `${ITEM}: about 3 days of stock left`;
const LOCATION = "Dressing room store";
const OFFICER = { email: "hub.officer@e2e.ph", name: "Ira Stockroom" };

let admin: Page;
let officer: Page;
let cashier: Page;
/** The administrator's API session for the set-up and the clean-up: sign-ins are rate limited. */
let api: StaffApi;
const ids = { facilityId: "", locationId: "", itemId: "" };

const nav = (page: Page): Locator => page.getByRole("navigation", { name: "Main" });
const tabs = (page: Page): Locator => page.getByRole("navigation", { name: "Suggestions sections" });
/** A suggestion card of this journey's item in a panel (other journeys' stock may have suggestions beside it). */
const card = (panel: Locator): Locator => panel.getByRole("article").filter({ hasText: ITEM });

interface RuleSetting {
  ruleId: string;
  setting: { version: number; enabled: boolean; parameters: Record<string, number> } | null;
}

/** Turns the stock rule on or off for the organization through the API (the settings screen is journey 34's). */
async function setRule(enabled: boolean): Promise<void> {
  const rules = await api.get<RuleSetting[]>("/assistant/rules");
  const setting = rules.find((r) => r.ruleId === RULE_ID)?.setting ?? null;
  if ((setting?.enabled ?? false) === enabled) return;
  await api.put(`/assistant/rules/${RULE_ID}/settings`, { facilityId: null, enabled, expectedVersion: setting?.version ?? 0 });
}

test.beforeAll(async ({ browser }) => {
  // The facility is read from the API (not the shared seed file), by name: other journeys add facilities.
  const bootstrap = await staffApi(STAFF.admin);
  const facility = (await bootstrap.get<Array<{ id: string; name: string }>>("/facilities")).find((f) => f.name === FACILITY);
  await bootstrap.dispose();
  if (!facility) throw new Error(`No facility named ${FACILITY}`);
  ids.facilityId = facility.id;
  api = await staffApi(STAFF.admin, ids.facilityId);

  const roles = await api.get<Array<{ id: string; key: string }>>("/roles");
  const role = roles.find((r) => r.key === "inventory_officer");
  if (!role) throw new Error("The built-in inventory_officer role is missing");
  const user = await api.post<{ id: string }>("/users", { email: OFFICER.email, displayName: OFFICER.name, initialPassword: STAFF_PASSWORD });
  await api.post(`/users/${user.id}/role-assignments`, { roleId: role.id });

  // A store and an item of its own: 100 packs in, 5 × 18 out, so the 10 left last about 3 days at the recent pace.
  ids.locationId = (await api.post<{ id: string }>("/inventory/locations", { facilityId: ids.facilityId, code: "hub-store", name: LOCATION })).id;
  ids.itemId = (
    await api.post<{ id: string }>("/inventory/items", {
      code: "gauze-4x4",
      name: ITEM,
      category: "medical_supply",
      stockUnit: "pack",
      tracksLots: true,
      controlled: false,
    })
  ).id;
  await api.post("/inventory/receipts", {
    locationId: ids.locationId,
    itemId: ids.itemId,
    lotNumber: "GZ-2611",
    expiryDate: manilaDate(365),
    quantity: 100,
    idempotencyKey: "e2e-hub-receipt-1",
  });
  for (let n = 1; n <= 5; n += 1) {
    await api.post("/inventory/issues", {
      locationId: ids.locationId,
      itemId: ids.itemId,
      quantity: 18,
      issuedTo: "Dressing room",
      idempotencyKey: `e2e-hub-issue-${n}`,
    });
  }
  await setRule(true);

  officer = await staffPage(browser, OFFICER.email, errors);
  admin = await staffPage(browser, STAFF.admin, errors);
  cashier = await staffPage(browser, STAFF.cashier, errors);
});

test.afterAll(async () => {
  // Leave the rule off for the journeys after this one, whatever happened above (best effort).
  await setRule(false).catch(() => undefined);
  await api?.dispose();
  await officer?.context().close();
  await admin?.context().close();
  await cashier?.context().close();
});

test("the inventory officer opens Assistant → Suggestions from the sidebar and finds the stock suggestion", async () => {
  await officer.goto("/");
  await nav(officer).getByRole("link", { name: "Suggestions", exact: true }).click();
  await officer.waitForURL(/\/assistant\/suggestions$/);
  await expect(officer.getByRole("heading", { name: "Suggestions", level: 1 })).toBeVisible();
  // Their role reads stock only: the overview and the Stock area.
  await expect(tabs(officer).getByRole("link")).toHaveText(["Overview", "Stock"]);

  const stock = officer.getByRole("region", { name: "Stock" });
  await expect(stock.getByText("Decision support", { exact: true })).toBeVisible();
  await expect(stock).toContainText(`1 of 3 checks are on at ${FACILITY}.`);
  // The overview shows each area's first three, warnings first; in a full run other items may come before this one.
  await expect(
    card(stock)
      .or(stock.getByText(/more on its tab/))
      .first(),
  ).toBeVisible();
  // No consultation, dental or prescribing check is the officer's to read.
  await expect(officer.getByText("Checks that speak inside a patient's record")).toHaveCount(0);
  await expect(officer.getByText("Suggestions come from fixed rules, not a diagnosis. You decide.")).toBeVisible();
});

test("the Stock area lists each check with its state, with the suggestion and a link to the inventory screen", async () => {
  await tabs(officer).getByRole("link", { name: "Stock" }).click();
  await officer.waitForURL(/\/assistant\/suggestions\/stock$/);
  const inventory = officer.getByRole("region", { name: "Inventory" });
  await expect(card(inventory).getByRole("heading", { name: SUGGESTION })).toBeVisible();
  await expect(card(inventory).getByText("Check soon", { exact: true })).toBeVisible();
  await expect(inventory.getByRole("link", { name: "Open Inventory" })).toHaveAttribute("href", "/inventory");

  // Every stock check the officer may read, on or off, without its thresholds (those stay on the settings page).
  const checks = officer.getByRole("list", { name: "Checks" });
  await expect(checks.getByRole("listitem")).toHaveCount(3);
  await expect(checks.getByRole("listitem").filter({ hasText: RULE_TITLE })).toContainText("On");
  for (const off of ["An item was issued much more than usual", "Stock may expire before it is used"]) {
    await expect(checks.getByRole("listitem").filter({ hasText: off })).toContainText("Off");
  }
  await expect(checks).not.toContainText("Delivery time");
});

test("dismissed in the Assistant section, it is hidden on the inventory screen too, for that person only", async () => {
  const inventory = officer.getByRole("region", { name: "Inventory" });
  await card(inventory).getByRole("button", { name: "Dismiss" }).click();
  await toast(officer, "Dismissed. It stays hidden for you for 14 days.");
  await expect(card(inventory)).toHaveCount(0);
  await expect(inventory.getByText("1 you dismissed recently is hidden.")).toBeVisible();

  await officer.goto("/inventory");
  const panel = officer.getByRole("region", { name: "Suggestions" });
  await expect(panel.getByText("1 you dismissed recently is hidden.")).toBeVisible();
  await expect(card(panel)).toHaveCount(0);

  // The administrator still sees it, with links to the rule settings and the insights.
  await admin.goto("/assistant/suggestions/stock");
  await expect(card(admin.getByRole("region", { name: "Inventory" })).getByRole("heading", { name: SUGGESTION })).toBeVisible();
  await admin.goto("/assistant/suggestions");
  await expect(admin.getByRole("link", { name: "Rule settings" })).toHaveAttribute("href", "/admin/assistant");
  await expect(admin.getByRole("link", { name: "Insights and reviews" })).toHaveAttribute("href", "/admin/assistant/insights");
});

test("a cashier, who reads no stock, is offered no Stock area and never sees the stock rule or its findings", async () => {
  await cashier.goto("/assistant/suggestions");
  await expect(cashier.getByRole("heading", { name: "Suggestions", level: 1 })).toBeVisible();
  await expect(cashier.getByRole("region", { name: "Billing" })).toBeVisible();
  await expect(cashier.getByRole("region", { name: "Stock" })).toHaveCount(0);
  await expect(cashier.getByText(ITEM)).toHaveCount(0);
  await expect(cashier.getByText(RULE_TITLE)).toHaveCount(0);
  // Typing the address leads back to the overview.
  await cashier.goto("/assistant/suggestions/stock");
  await cashier.waitForURL(/\/assistant\/suggestions$/);
  await expect(cashier.getByText(ITEM)).toHaveCount(0);
});

test("turned off again, the Stock area says nothing is checked, and nothing broke along the way", async () => {
  await setRule(false);
  await officer.goto("/assistant/suggestions/stock");
  const inventory = officer.getByRole("region", { name: "Inventory" });
  await expect(inventory).toContainText(`No check is turned on at ${FACILITY}.`);
  await expect(inventory.getByText("An administrator turns these checks on under Settings → Assistant.")).toBeVisible();
  await expect(officer.getByRole("list", { name: "Checks" }).getByRole("listitem").filter({ hasText: RULE_TITLE })).toContainText("Off");
  expect(errors).toEqual([]);
});
