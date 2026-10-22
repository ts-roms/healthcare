import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { staffApi } from "../support/api";
import { STAFF, STAFF_URL } from "../support/env";
import { staffPage, toast, watchErrors } from "../support/pages";

/**
 * Administration: a staff member is added, given a role (organization-wide and for one facility), revoked with a reason,
 * made to choose their own password after a temporary one, suspended and reactivated; an organization role is created,
 * edited (with the optimistic version) and its holder gains and loses a menu entry at the next request; built-in roles
 * stay read-only; a department, a second facility, a service point, a diagnosis coding system, a room and consent
 * wording are configured; the audit trail shows each change with actor, facility and reason and can be filtered; and
 * a cashier is turned away from the administration pages.
 */
test.describe.configure({ mode: "serial" });

const errors: string[] = [];

const ROLE = { key: "e2e_records_auditor", name: "E2E Records Auditor", renamed: "E2E Records Auditor Plus", description: "Reads the audit trail" };
const NEWHIRE = {
  email: "nia.newhire@e2e.ph",
  name: "Nia Newhire",
  first: "First-Handed-Passphrase-1",
  temporary: "Temporary-Handed-Passphrase-1",
  own: "Nia-Own-Passphrase-2026",
};
const DEPARTMENT = { name: "Adminjourney Records Room", code: "adminjourney-records" };
const FACILITY = { name: "Adminjourney Satellite Clinic", code: "adminjourney-satellite" };
const SERVICE_POINT = { code: "adminjourney-window", name: "Adminjourney Window", renamed: "Adminjourney Window 2" };
const CODING = { key: "adminjourney-cs", name: "Adminjourney Coding", renamed: "Adminjourney Coding Renamed", version: "2026" };
const ROOM = { name: "Adminjourney Room", code: "adminjourney-room" };
const WORDING = {
  title: "Adminjourney research consent",
  body: "Adminjourney: our own words about using de-identified records for research.",
  acknowledgement: "I have read this and I agree.",
};
const SUSPEND_REASON = "Adminjourney suspended pending credential review";
const REVOKE_REASON = "Adminjourney facility access not needed";

let admin: Page;
let adminName = "";
let adminId = "";
let hire: Page | undefined;
let hireUserId = "";

const roleCard = (page: Page, name: string): Locator =>
  page.locator('section[data-slot="card"]').filter({ has: page.getByRole("heading", { name, exact: true }) });
const nav = (page: Page): Locator => page.getByRole("navigation", { name: "Main" });

/** The administration pages in the Settings menu (the Settings home lists what the member may open; nothing when they may open none). */
async function adminMenu(page: Page): Promise<string[]> {
  await page.goto("/admin");
  return page
    .getByRole("navigation", { name: "Settings" })
    .locator('a[href^="/admin/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
}

/** Signs a staff user in with a given password, in a new browser context; waits out the sign-in rate limit once. */
async function signInAs(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: STAFF_URL });
  const page = await context.newPage();
  watchErrors(page, email, errors);
  await page.goto("/login");
  for (let attempt = 1; ; attempt += 1) {
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    const outcome = await Promise.race([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }).then(() => "signed-in" as const),
      page
        .getByRole("alert")
        .filter({ hasText: /\S/ })
        .first()
        .waitFor({ timeout: 20_000 })
        .then(() => "refused" as const),
    ]).catch(() => "timeout" as const);
    if (outcome === "signed-in") return page;
    const message = outcome === "refused" ? await page.getByRole("alert").filter({ hasText: /\S/ }).first().innerText() : "no answer";
    if (attempt >= 2 || !/too many|rate|limit|try again/i.test(message)) throw new Error(`Sign-in as ${email} failed: ${message}`);
    await page.waitForTimeout(61_000);
    await page.goto("/login");
  }
}

test.beforeAll(async ({ browser }) => {
  // The facility comes from the API, not the shared seed state file: this journey does not depend on set-up ids.
  const bootstrap = await staffApi(STAFF.admin);
  const [facility] = await bootstrap.get<Array<{ id: string }>>("/facilities");
  await bootstrap.dispose();
  const api = await staffApi(STAFF.admin, facility!.id);
  const users = await api.get<Array<{ id: string; email: string; displayName: string }>>("/users");
  const me = users.find((u) => u.email === STAFF.admin)!;
  adminId = me.id;
  adminName = me.displayName;
  await api.dispose();
  admin = await staffPage(browser, STAFF.admin, errors);
});

test.afterAll(async () => {
  await admin?.context().close();
  await hire?.context().close();
});

test("an organization role is created within the administrator's own permissions", async () => {
  await admin.goto("/admin/roles");
  await admin.getByRole("button", { name: "New role…" }).click();
  await admin.locator("#role-name").fill(ROLE.name);
  await admin.locator("#role-key").fill(ROLE.key);
  await admin.locator("#role-description").fill(ROLE.description);
  const create = admin.getByRole("button", { name: "Create role" });
  await expect(create).toBeDisabled();
  await admin.getByRole("checkbox", { name: "audit.read", exact: true }).click();
  await expect(create).toBeEnabled();
  await create.click();
  await toast(admin, `${ROLE.name} created`);

  const card = roleCard(admin, ROLE.name);
  await expect(card).toBeVisible();
  await expect(card.getByText("Your organization")).toBeVisible();
  await expect(card.getByText("audit.read")).toBeVisible();
  await expect(card.getByText(ROLE.description)).toBeVisible();
});

test("built-in roles are read-only: only the organization's own roles can be edited", async () => {
  await admin.goto("/admin/roles");
  const builtIn = admin.locator('section[data-slot="card"]').filter({ hasText: "Built-in" });
  const own = admin.locator('section[data-slot="card"]').filter({ hasText: "Your organization" });
  expect(await builtIn.count()).toBeGreaterThan(5);
  await expect(builtIn.getByRole("button", { name: "Edit…" })).toHaveCount(0);
  await expect(own.getByRole("button", { name: "Edit…" })).toHaveCount(await own.count());
  // The built-in physician role is listed with its permissions, nothing to change.
  await expect(builtIn.filter({ has: admin.getByRole("heading", { name: "Physician", exact: true }) })).toHaveCount(1);
});

test("a staff member is added and given the role organization-wide and for one facility", async () => {
  await admin.goto("/admin/users");
  await admin.getByRole("button", { name: "Add staff member" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.locator("#staff-email").fill(NEWHIRE.email);
  await dialog.locator("#staff-name").fill(NEWHIRE.name);
  await dialog.locator("#staff-password").fill(NEWHIRE.first);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await toast(admin, `${NEWHIRE.name} added`);
  await admin.waitForURL(/\/admin\/users\/[0-9a-f-]{36}$/);
  hireUserId = /users\/([0-9a-f-]{36})/.exec(admin.url())![1]!;
  await expect(admin.getByText("No role yet")).toBeVisible();

  await admin.locator("#grant-role").selectOption({ label: ROLE.name });
  await admin.getByRole("button", { name: "Grant", exact: true }).click();
  await toast(admin, "Role granted");
  await expect(admin.getByRole("listitem").filter({ hasText: ROLE.name }).filter({ hasText: "Organization-wide" })).toBeVisible();

  await admin.locator("#grant-role").selectOption({ label: ROLE.name });
  await admin.locator("#grant-facility").selectOption({ label: "E2E Main Clinic" });
  await admin.getByRole("button", { name: "Grant", exact: true }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: ROLE.name }).filter({ hasText: "E2E Main Clinic" })).toBeVisible();
});

test("a role granted for one facility is revoked with a reason, and the other one stays", async () => {
  const item = admin.getByRole("listitem").filter({ hasText: ROLE.name }).filter({ hasText: "E2E Main Clinic" });
  await item.getByRole("button", { name: "Revoke…" }).click();
  await item.getByLabel(`Why revoke ${ROLE.name}?`).fill("x");
  await item.getByLabel(`Why revoke ${ROLE.name}?`).fill(REVOKE_REASON);
  await item.getByRole("button", { name: "Revoke", exact: true }).click();
  await toast(admin, `${ROLE.name} revoked`);
  await expect(admin.getByRole("listitem").filter({ hasText: ROLE.name }).filter({ hasText: "E2E Main Clinic" })).toHaveCount(0);
  await expect(admin.getByRole("listitem").filter({ hasText: ROLE.name }).filter({ hasText: "Organization-wide" })).toBeVisible();
});

test("the new member signs in with a temporary password and must choose their own before anything opens", async ({ browser }) => {
  await admin.getByRole("button", { name: "Reset password…" }).click();
  await admin.locator("#temporary-password").fill(NEWHIRE.temporary);
  await admin.locator("#temporary-password-again").fill(NEWHIRE.temporary);
  await admin.locator("#reset-reason").fill("Adminjourney hand-over, confirmed in person");
  await admin.getByRole("button", { name: "Set temporary password" }).click();
  await toast(admin, "Temporary password set");

  hire = await signInAs(browser, NEWHIRE.email, NEWHIRE.temporary);
  await expect(hire.getByText("Choose your own password")).toBeVisible();
  // Nothing else opens: another page still only asks for the new password.
  await hire.goto("/admin/audit");
  await expect(hire.getByText("Choose your own password")).toBeVisible();
  await expect(hire.getByText("Who did what, when and to which record")).toHaveCount(0);

  await hire.locator("#current-password").fill(NEWHIRE.temporary);
  await hire.locator("#new-password").fill(NEWHIRE.own);
  await hire.locator("#confirm-password").fill(NEWHIRE.own);
  await hire.getByRole("button", { name: "Choose this password" }).click();
  await toast(hire, "Password changed");
  await expect(hire.getByText("Choose your own password")).toHaveCount(0);

  // The role gives exactly the audit log.
  await hire.goto("/");
  await expect.poll(() => adminMenu(hire!)).toEqual(["/admin/audit"]);
  await hire.goto("/admin/audit");
  await expect(hire.getByRole("heading", { name: "Audit log" })).toBeVisible();
});

test("editing the role changes what its holder can open at the next request, and a stale edit is refused", async () => {
  // Two tabs of the same administrator: the second loads the role before the first saves.
  const stale = await admin.context().newPage();
  watchErrors(stale, "admin (second tab)", errors);
  await stale.goto("/admin/roles");
  await roleCard(stale, ROLE.name).getByRole("button", { name: "Edit…" }).click();

  await admin.goto("/admin/roles");
  const card = roleCard(admin, ROLE.name);
  await card.getByRole("button", { name: "Edit…" }).click();
  await card.getByLabel("Name", { exact: true }).fill(ROLE.renamed);
  await card.getByLabel(/^Description/).fill(`${ROLE.description} and the staff list`);
  await card.getByRole("checkbox", { name: "user.read", exact: true }).click();
  await card.getByLabel(/^Reason/).fill("Adminjourney widen to staff list");
  await card.getByRole("button", { name: "Save role" }).click();
  await toast(admin, `${ROLE.renamed} updated`);
  await expect(roleCard(admin, ROLE.renamed).getByText("user.read")).toBeVisible();

  // The stale tab still carries the old version.
  const staleCard = roleCard(stale, ROLE.name);
  await staleCard.getByLabel("Name", { exact: true }).fill("E2E Stale Edit");
  await staleCard.getByRole("button", { name: "Save role" }).click();
  await toast(stale, /Someone else updated this just now/);
  await stale.close();

  // The holder gains the staff list without signing in again.
  await hire!.goto("/");
  await expect.poll(() => adminMenu(hire!)).toEqual(["/admin/users", "/admin/roles", "/admin/security", "/admin/audit"]);
  await hire!.goto("/admin/users");
  await expect(hire!.getByRole("heading", { name: "Staff users" })).toBeVisible();
  await expect(hire!.getByText(NEWHIRE.name).first()).toBeVisible();
  // They can read but not manage: no button to add staff.
  await expect(hire!.getByRole("button", { name: "Add staff member" })).toHaveCount(0);

  // Take it away again.
  const again = roleCard(admin, ROLE.renamed);
  await again.getByRole("button", { name: "Edit…" }).click();
  await again.getByRole("checkbox", { name: "user.read", exact: true }).click();
  await again.getByRole("button", { name: "Save role" }).click();
  await toast(admin, `${ROLE.renamed} updated`);
  await hire!.goto("/admin/users");
  await expect(hire!.getByRole("heading", { name: "Staff users" })).toHaveCount(0);
  await hire!.goto("/");
  await expect.poll(() => adminMenu(hire!)).toEqual(["/admin/audit"]);
});

test("a suspended member is signed out and refused, and can sign in again once reactivated", async ({ browser }) => {
  await admin.goto(`/admin/users/${hireUserId}`);
  await admin.getByRole("button", { name: "Suspend…" }).click();
  await admin.locator("#membership-reason").fill(SUSPEND_REASON);
  await admin.getByRole("button", { name: "Suspend", exact: true }).click();
  await toast(admin, /Suspended; their sessions have ended/);

  // Their open session ended at once.
  await hire!.goto("/");
  await expect(hire!).toHaveURL(/\/login/);
  await hire!.context().close();
  hire = undefined;

  // A new sign-in is refused.
  const context = await browser.newContext({ baseURL: STAFF_URL });
  const refused = await context.newPage();
  watchErrors(refused, "suspended member", errors);
  await refused.goto("/login");
  await refused.locator("#email").fill(NEWHIRE.email);
  await refused.locator("#password").fill(NEWHIRE.own);
  await refused.getByRole("button", { name: /sign in/i }).click();
  await expect(refused.getByRole("alert").filter({ hasText: /\S/ }).first()).toBeVisible();
  await expect(refused).toHaveURL(/\/login/);
  await context.close();

  await admin.goto(`/admin/users/${hireUserId}`);
  await expect(admin.getByText("Suspended").first()).toBeVisible();
  await admin.getByRole("button", { name: "Reactivate…" }).click();
  await admin.locator("#membership-reason").fill("Adminjourney review finished");
  await admin.getByRole("button", { name: "Reactivate", exact: true }).click();
  await toast(admin, "Reactivated");

  hire = await signInAs(browser, NEWHIRE.email, NEWHIRE.own);
  await hire.goto("/");
  await expect.poll(() => adminMenu(hire!)).toEqual(["/admin/audit"]);
});

test("a department and a second facility are added, and the facility can be set inactive", async () => {
  await admin.goto("/admin/facilities");
  const main = admin.locator('section[data-slot="card"]').filter({ has: admin.getByRole("heading", { name: "E2E Main Clinic", exact: true }) });
  await main.getByRole("button", { name: "Add department…" }).click();
  await main.getByLabel("Name", { exact: true }).fill(DEPARTMENT.name);
  await main.getByLabel("Code", { exact: true }).fill(DEPARTMENT.code);
  await main.getByRole("button", { name: "Add", exact: true }).click();
  await toast(admin, `${DEPARTMENT.name} added`);
  await expect(main.getByText(DEPARTMENT.name)).toBeVisible();

  await admin.getByRole("button", { name: "New facility" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.locator("#new-facility-code").fill(FACILITY.code);
  await dialog.locator("#new-facility-name").fill(FACILITY.name);
  await dialog.getByRole("button", { name: "Add facility" }).click();
  await toast(admin, `${FACILITY.name} added`);
  const satellite = admin.locator('section[data-slot="card"]').filter({ has: admin.getByRole("heading", { name: FACILITY.name, exact: true }) });
  await expect(satellite.getByText("Active", { exact: true })).toBeVisible();

  await satellite.getByRole("button", { name: "Edit…" }).click();
  await admin.getByRole("dialog").getByLabel("Status").selectOption("inactive");
  await admin.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await toast(admin, "Facility saved");
  await expect(satellite.getByText("Inactive", { exact: true })).toBeVisible();
});

test("a service point is added, renamed and deactivated", async () => {
  await admin.goto("/admin/service-points");
  await admin.locator("#service-point-code").fill(SERVICE_POINT.code);
  await admin.locator("#service-point-name").fill(SERVICE_POINT.name);
  await admin.locator("#service-point-location").fill("Adminjourney counter");
  await admin.getByRole("button", { name: "Add service point" }).click();
  await toast(admin, `${SERVICE_POINT.name} added`);
  const row = (name: string) => admin.getByRole("row").filter({ hasText: name });
  await expect(row(SERVICE_POINT.name)).toContainText("In use");

  await row(SERVICE_POINT.name).getByRole("button", { name: "Edit" }).click();
  await admin.locator("#service-point-name").fill(SERVICE_POINT.renamed);
  await admin.getByRole("button", { name: "Save changes" }).click();
  await toast(admin, `${SERVICE_POINT.renamed} updated`);

  await row(SERVICE_POINT.renamed).getByRole("button", { name: "Deactivate" }).click();
  await toast(admin, `${SERVICE_POINT.renamed} deactivated`);
  await expect(row(SERVICE_POINT.renamed)).toContainText("Inactive");
});

test("a diagnosis coding system is registered, renamed and no longer offered", async () => {
  await admin.goto("/clinic/coding-systems");
  await admin.locator("#cs-key").fill(CODING.key);
  await admin.locator("#cs-name").fill(CODING.name);
  await admin.locator("#cs-version").fill(CODING.version);
  await admin.getByRole("button", { name: "Register", exact: true }).click();
  await toast(admin, `${CODING.name} registered`);
  const row = (name: string) => admin.getByRole("row").filter({ hasText: name });
  await expect(row(CODING.name)).toContainText("In use");

  await row(CODING.name).getByRole("button", { name: "Edit" }).click();
  await admin.locator("#cs-name").fill(CODING.renamed);
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  await toast(admin, `${CODING.renamed} updated`);

  await row(CODING.renamed).getByRole("button", { name: "Stop offering" }).click();
  await toast(admin, /no longer offered for new diagnoses/);
  await expect(row(CODING.renamed)).toContainText("Not offered");
});

test("a consulting room is added in the scheduling set-up", async () => {
  await admin.goto("/appointments/schedules");
  await admin.waitForLoadState("networkidle");
  await admin.getByRole("button", { name: "Add a room…" }).click();
  await admin.locator("#room-name").fill(ROOM.name);
  await admin.locator("#room-code").fill(ROOM.code);
  await admin.getByRole("button", { name: "Add room" }).click();
  await toast(admin, "Room added");
  await expect(admin.getByText(ROOM.name).first()).toBeVisible();
});

test("consent wording is published for a consent type and can be withdrawn from online use", async () => {
  await admin.goto("/admin/consent-wording");
  await expect(admin.getByText("No wording yet").first()).toBeVisible();
  await admin.locator("#research-title").fill(WORDING.title);
  await admin.locator("#research-body").fill(WORDING.body);
  await admin.locator("#research-ack").fill(WORDING.acknowledgement);
  const research = roleCard(admin, "Research");
  await research.getByRole("button", { name: "Publish and offer online" }).click();
  await toast(admin, /Version 1 is now offered online/);
  await expect(research.getByText("Offered online · version 1")).toBeVisible();

  await research.getByRole("button", { name: "Stop offering online" }).click();
  await toast(admin, "No longer offered online");
  await expect(research.getByText("Not offered · version 2")).toBeVisible();
});

test("the audit trail shows the changes with who, where and why, and can be filtered by action and by person", async () => {
  await admin.goto("/admin/audit");
  const search = async (action: string) => {
    await admin.locator("#audit-action").fill(action);
    await admin.getByRole("button", { name: "Search", exact: true }).click();
    await admin.waitForURL((url) => url.searchParams.get("action") === action);
  };
  const rows = admin.getByRole("row");

  await search("user.membership-status");
  const suspended = rows.filter({ hasText: SUSPEND_REASON });
  await expect(suspended).toHaveCount(1);
  await expect(suspended).toContainText(adminName);
  await expect(suspended).toContainText("user.membership-status");
  await expect(suspended).toContainText("Success");
  await expect(rows.filter({ hasText: "role.create" })).toHaveCount(0);

  await search("user.role-revoke");
  const revoked = rows.filter({ hasText: REVOKE_REASON });
  await expect(revoked).toHaveCount(1);
  await expect(revoked).toContainText(adminName);

  await search("role.update");
  await expect(rows.filter({ hasText: "Adminjourney widen to staff list" })).toHaveCount(1);

  await search("service-point.create");
  const created = rows.filter({ hasText: "service-point.create" }).first();
  await expect(created).toBeVisible();
  await expect(created).toContainText("E2E Main Clinic");

  for (const action of [
    "role.create",
    "user.add-member",
    "user.role-grant",
    "user.password-reset",
    "department.create",
    "facility.create",
    "coding-system.update",
    "room.create",
    "consent.wording-publish",
  ]) {
    await search(action);
    await expect(rows.filter({ hasText: action }).first(), action).toBeVisible();
  }

  // Filter by person: the administrator's changes appear, the new member (who only read the audit log) has none of these actions.
  await admin.goto("/admin/audit");
  await admin.locator("#audit-actor").selectOption(adminId);
  await admin.locator("#audit-action").fill("role.create");
  await admin.getByRole("button", { name: "Search", exact: true }).click();
  await admin.waitForURL((url) => url.searchParams.get("actor") === adminId);
  await expect(rows.filter({ hasText: "role.create" }).first()).toContainText(adminName);
  await admin.goto(`/admin/audit?actor=${hireUserId}&action=role.create`);
  await expect(admin.getByText("Nothing matches.")).toBeVisible();
});

test("a cashier cannot open the administration pages, and nothing broke along the way", async ({ browser }) => {
  const cashier = await staffPage(browser, STAFF.cashier, errors);
  for (const path of ["/admin/users", "/admin/roles", "/admin/audit", "/admin/consent-wording", "/admin/service-points"]) {
    await cashier.goto(path);
    // Sent back to the dashboard, with none of the administration content.
    await expect(cashier).toHaveURL((url) => url.pathname === "/");
  }
  await expect(cashier.getByRole("heading", { name: "Staff users" })).toHaveCount(0);
  await expect(nav(cashier).locator('a[href^="/admin/"]')).toHaveCount(0);
  await cashier.context().close();

  expect(errors).toEqual([]);
});
