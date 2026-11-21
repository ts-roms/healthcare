import { expect, type Locator, type Page, test } from "@playwright/test";
import { manilaDate, type StaffApi, staffApi } from "../support/api";
import { STAFF, STAFF_PASSWORD } from "../support/env";
import { clickUntilVisible, staffPage, toast } from "../support/pages";

/**
 * The heuristic assistant (docs/domains/assistant.md, ADR-0018), phases 0 and 4: every rule is off until an administrator
 * turns it on, so the administrator turns the stock rule on for the whole organization; stock is received and issued until
 * what is left would not last a delivery; the inventory officer sees the suggestion on the inventory screen as decision
 * support, reads why it was made (its evidence, rule and version), follows its link (counted as followed) and marks it not
 * useful with a reason, after which it is hidden for them. The administrator then reads how the rule was used (shown,
 * followed, not useful, what staff said) and records a review retiring it, which turns it off wherever it was on
 * (docs/runbooks/assistant-rule-review.md).
 */
test.describe.configure({ mode: "serial" });

const errors: string[] = [];

const RULE_ID = "inventory.days-of-cover";
const RULE_TITLE = "Stock may run out before a delivery arrives";
/** The seeded clinic, which `staffPage` selects in the top bar (support/prepare-database.ts). */
const FACILITY = "E2E Main Clinic";
const ITEM = "Nitrile examination gloves, medium";
const LOCATION = "Treatment room store";
/** No seeded account holds the inventory officer's role: the administrator makes one for this journey. */
const OFFICER = { email: "stock.officer@e2e.ph", name: "Ines Inventory" };
const REASON = "Gloves come from the central store every week, so a 14-day delivery time does not apply to them.";
const REVIEW_NOTE = "Quarterly review with the operations lead: our supplies are restocked weekly, so this rule flags stock that is not at risk.";
const FALSE_POSITIVES = "Supplies restocked weekly from the central store are shown as running out.";

let admin: Page;
let officer: Page;
/** The administrator's API session for the set-up (and the clean-up below): sign-ins are rate limited. */
let api: StaffApi;
const ids = { facilityId: "", locationId: "", itemId: "" };
/** Set once the review has turned the rule off again. */
let retired = false;

const titledCard = (page: Page, title: string): Locator =>
  page.locator('section[data-slot="card"]').filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const ruleCard = (page: Page): Locator => titledCard(page, RULE_TITLE);
const panel = (page: Page): Locator => page.getByRole("region", { name: "Suggestions" });
/** This journey's own item: in a full run, items of other journeys may have suggestions of the same rule beside it. */
const suggestion = (page: Page): Locator => panel(page).getByRole("article").filter({ hasText: ITEM });
const stockRow = (page: Page): Locator => page.getByRole("row").filter({ hasText: ITEM }).filter({ hasText: LOCATION });
/** A count on a rule's insights page ("Shown", "Followed", "Dismissed", "Not useful"). */
const figure = (page: Page, label: string): Locator =>
  page
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator("dd");
const showAtOrganization = (page: Page): Locator => ruleCard(page).getByRole("checkbox", { name: "Show these suggestions at the whole organization" });

test.beforeAll(async ({ browser }) => {
  // The facility is read from the API (not the shared seed file), so the journey depends only on its own database. By
  // name: other journeys add facilities (one of them inactive), and the stock must be where the browsers work.
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

  // A store and an item of its own, so stock other journeys move never changes what this one counts.
  const location = await api.post<{ id: string }>("/inventory/locations", { facilityId: ids.facilityId, code: "assistant-store", name: LOCATION });
  ids.locationId = location.id;
  const item = await api.post<{ id: string }>("/inventory/items", {
    code: "gloves-nitrile-m",
    name: ITEM,
    category: "ppe",
    stockUnit: "box",
    tracksLots: true,
    controlled: false,
  });
  ids.itemId = item.id;

  admin = await staffPage(browser, STAFF.admin, errors);
  officer = await staffPage(browser, OFFICER.email, errors);
});

test.afterAll(async () => {
  // A run stopped half-way would leave the rule on for the journeys after this one: turn it off again (best effort).
  if (api && !retired) {
    try {
      const rules =
        await api.get<Array<{ ruleId: string; setting: { version: number; enabled: boolean; parameters: Record<string, number> } | null }>>("/assistant/rules");
      const setting = rules.find((r) => r.ruleId === RULE_ID)?.setting;
      if (setting?.enabled) {
        await api.put(`/assistant/rules/${RULE_ID}/settings`, {
          facilityId: null,
          enabled: false,
          parameters: setting.parameters,
          expectedVersion: setting.version,
        });
      }
    } catch {
      // The journey's own failure is the one worth reading.
    }
  }
  await api?.dispose();
  await admin?.context().close();
  await officer?.context().close();
});

test("every rule is off until an administrator turns it on: the stock rule, for the whole organization", async () => {
  await admin.goto("/admin");
  await admin.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Assistant", exact: true }).click();
  await admin.waitForURL(/\/admin\/assistant$/);
  const rule = ruleCard(admin);
  await expect(rule.getByText("Off: not turned on yet")).toBeVisible();
  await expect(showAtOrganization(admin)).not.toBeChecked();
  // The starting thresholds are kept: a 14-day delivery time, the pace of the last 30 days, 5 issues for a firm pace.
  await expect(rule.getByLabel("Delivery time")).toHaveValue("14");
  await expect(rule.getByLabel("Pace measured over the last")).toHaveValue("30");
  await expect(rule.getByLabel("Issues needed for a firm pace")).toHaveValue("5");

  await expect(async () => {
    await showAtOrganization(admin).check({ timeout: 2_000 });
    await expect(showAtOrganization(admin)).toBeChecked({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await rule.getByRole("button", { name: "Save", exact: true }).click();
  await toast(admin, "Turned on for the whole organization");
  await expect(rule.getByText("On for the whole organization")).toBeVisible();
  await expect(showAtOrganization(admin)).toBeChecked();
  // On and never reviewed: due for review.
  await expect(admin.getByText(/^1 rule is due for review/)).toBeVisible();
});

test("stock is received and issued until what is left would not last a delivery", async () => {
  // Through the API, as the stock room records a delivery and what it hands out: 100 boxes in, 5 × 18 out, all inside the
  // rule's 30-day window (about 3 boxes a day, so the 10 left last about 3 days).
  await api.post("/inventory/receipts", {
    locationId: ids.locationId,
    itemId: ids.itemId,
    lotNumber: "GLV-2611",
    expiryDate: manilaDate(365),
    quantity: 100,
    reference: "DR-2611",
    idempotencyKey: "e2e-assistant-receipt-1",
  });
  for (let n = 1; n <= 5; n += 1) {
    await api.post("/inventory/issues", {
      locationId: ids.locationId,
      itemId: ids.itemId,
      quantity: 18,
      issuedTo: "Treatment room",
      idempotencyKey: `e2e-assistant-issue-${n}`,
    });
  }
  await officer.goto("/inventory");
  await expect(stockRow(officer)).toContainText("10 box");
  await expect(stockRow(officer)).toContainText("GLV-2611");
});

test("the inventory officer sees the suggestion as decision support and reads why it was made", async () => {
  await officer.goto("/inventory");
  await expect(panel(officer).getByText("Decision support", { exact: true })).toBeVisible();
  await expect(panel(officer)).toContainText("Suggestions come from fixed rules, not a diagnosis. You decide.");
  const card = suggestion(officer);
  await expect(card.getByRole("heading", { name: `${ITEM}: about 3 days of stock left` })).toBeVisible();
  // Less than half the delivery time left: a warning, shown as a label with an icon, not colour alone.
  await expect(card.getByText("Check soon", { exact: true })).toBeVisible();
  // Five issues in the window: a firm pace, not "limited data".
  await expect(card.getByText("Based on limited data")).toHaveCount(0);
  await expect(card).toContainText("about 3.0 box a day");
  await expect(card).toContainText("Ordering 80 box would cover 30 days at that pace.");

  await clickUntilVisible(card.getByRole("button", { name: "Why?" }), card.getByText(`Rule ${RULE_ID}, version 1.`));
  await expect(card.getByText("A pattern in your own records")).toBeVisible();
  await expect(card.getByRole("listitem").filter({ hasText: "Usable stock: 10 box" })).toBeVisible();
  await expect(card.getByRole("listitem").filter({ hasText: "Issued in 30 days: 90 box in 5 issues" })).toBeVisible();
});

test("following its link is counted as followed, and hides nothing", async () => {
  const link = suggestion(officer).getByRole("link", { name: "Open purchase orders" });
  await expect(link).toHaveAttribute("href", "/inventory/purchase-orders");
  await link.click();
  await officer.waitForURL(/\/inventory\/purchase-orders$/);
  await expect(officer.getByRole("heading", { name: "Purchase orders" }).first()).toBeVisible();

  // Back on the inventory screen the suggestion is still there: following it answered nothing.
  await officer.goto("/inventory");
  await expect(suggestion(officer)).toBeVisible();
});

test("marked not useful with a reason, the suggestion is hidden for the officer", async () => {
  const card = suggestion(officer);
  const reason = card.getByLabel("What was wrong with it? (optional)");
  await clickUntilVisible(card.getByRole("button", { name: "Not useful", exact: true }), reason);
  await expect(card).toContainText("Do not write a patient's name or details.");
  await reason.fill(REASON);
  await card.getByRole("button", { name: "Mark not useful" }).click();
  await toast(officer, "Marked not useful. It stays hidden for you for 14 days.");
  await expect(suggestion(officer)).toHaveCount(0);
  await expect(panel(officer).getByText("1 you dismissed recently is hidden.")).toBeVisible();

  // It stays hidden when the officer comes back.
  await officer.goto("/inventory");
  await expect(panel(officer).getByText("1 you dismissed recently is hidden.")).toBeVisible();
  await expect(suggestion(officer)).toHaveCount(0);
});

test("the administrator reads how the rule was used and what staff said", async () => {
  await admin.goto("/admin/assistant");
  await admin.getByRole("link", { name: "Open insights and reviews" }).click();
  await admin.waitForURL(/\/admin\/assistant\/insights$/);
  const row = admin.getByRole("row").filter({ has: admin.getByRole("link", { name: RULE_TITLE, exact: true }) });
  await expect(row.getByText("Review due")).toBeVisible();
  await expect(row.getByText("Not reviewed yet")).toBeVisible();
  await row.getByRole("link", { name: RULE_TITLE, exact: true }).click();
  await admin.waitForURL(new RegExp(`/admin/assistant/insights/${RULE_ID.replaceAll(".", "\\.")}\\?days=90$`));
  await expect(admin.getByRole("heading", { name: RULE_TITLE })).toBeVisible();

  // The followed link is sent as a beacon while the page changes: read the counts once it has arrived.
  await expect(async () => {
    await admin.reload();
    await expect(figure(admin, "Followed")).toHaveText("1", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(figure(admin, "Not useful")).toHaveText("1");
  await expect(figure(admin, "Dismissed")).toHaveText("0");
  // Each page load that showed the suggestion counts: at least the officer's first visit and the one after the link.
  expect(Number(await figure(admin, "Shown").innerText())).toBeGreaterThanOrEqual(2);
  await expect(admin.getByText("50% of answers were dismissals", { exact: false })).toBeVisible();
  await expect(admin.getByText(`Rule ${RULE_ID}, version 1.`)).toBeVisible();
  await expect(admin.getByText("Review due")).toBeVisible();

  const said = titledCard(admin, "What staff said").getByRole("listitem").filter({ hasText: REASON });
  await expect(said).toBeVisible();
  await expect(said).toContainText("Not useful ·");
});

test("a review retiring the rule turns it off everywhere, and its settings card shows the review", async () => {
  const retire = admin.getByRole("button", { name: "Retire the rule" });
  await clickUntilVisible(admin.getByRole("radio", { name: /^Retire it/ }), retire);
  await admin.getByLabel("What was decided and why").fill(REVIEW_NOTE);
  await admin.getByLabel("False positives found (optional)").fill(FALSE_POSITIVES);
  await retire.click();
  await toast(admin, "Review recorded; the rule is now off everywhere.");

  const review = titledCard(admin, "Reviews").getByRole("listitem").filter({ hasText: REVIEW_NOTE });
  await expect(review).toContainText(/\d{4}-\d{2}-\d{2} · Retire it · version 1 · recorded by E2E Administrator/);
  await expect(review).toContainText(FALSE_POSITIVES);
  // Off now, so no longer due for review.
  await expect(admin.getByText("Review due")).toHaveCount(0);

  await admin.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Assistant", exact: true }).click();
  await admin.waitForURL(/\/admin\/assistant$/);
  const rule = ruleCard(admin);
  await expect(rule.getByText("Off for the whole organization")).toBeVisible();
  await expect(showAtOrganization(admin)).not.toBeChecked();
  await expect(rule).toContainText("Retired after review on");
  await expect(rule).toContainText(REVIEW_NOTE);
  await expect(rule).toContainText(FALSE_POSITIVES);
  retired = true;
});

test("retired, the rule says nothing on the inventory screen any more, and nothing broke along the way", async () => {
  await officer.goto("/inventory");
  await expect(stockRow(officer)).toContainText("10 box");
  await expect(panel(officer)).toHaveCount(0);
  expect(errors).toEqual([]);
});
