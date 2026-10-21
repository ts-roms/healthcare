import { type Browser, expect, type Page, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { STAFF, STAFF_PASSWORD, STAFF_URL } from "../support/env";
import { toast, watchErrors } from "../support/pages";

/**
 * An administrator changes their own password at My account (/account): a wrong current password, a mismatch and a weak
 * password are refused with a clear message (never a request id), the change signs the other sessions out, and the new
 * password — not the old — signs in. Uses its own administrator so the shared one keeps its password for other journeys.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];
const EMAIL = "pw.admin@e2e.ph";
const NEW_PASSWORD = "A-Brand-New-Passphrase-2";

let admin: Page;
let other: Page;

async function signIn(browser: Browser, password: string): Promise<{ page: Page; failed: string | null }> {
  const context = await browser.newContext({ baseURL: STAFF_URL });
  const page = await context.newPage();
  watchErrors(page, EMAIL, errors);
  await page.goto("/login");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  const outcome = await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }).then(() => "in" as const),
    page
      .getByRole("alert")
      .filter({ hasText: /\S/ })
      .first()
      .waitFor({ timeout: 20_000 })
      .then(() => "refused" as const),
  ]);
  return { page, failed: outcome === "refused" ? await page.getByRole("alert").filter({ hasText: /\S/ }).first().innerText() : null };
}

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const roles = await api.get<Array<{ id: string; key: string }>>("/roles");
  const created = await api.post<{ id: string }>("/users", { email: EMAIL, displayName: "Password Admin", initialPassword: STAFF_PASSWORD });
  await api.post(`/users/${created.id}/role-assignments`, { roleId: roles.find((r) => r.key === "org_admin")!.id });
  await api.dispose();

  const first = await signIn(browser, STAFF_PASSWORD);
  expect(first.failed).toBeNull();
  admin = first.page;
  // A second browser signed in as the same administrator: the change ends its session.
  const second = await signIn(browser, STAFF_PASSWORD);
  expect(second.failed).toBeNull();
  other = second.page;
});

test.afterAll(async () => {
  await admin?.context().close();
  await other?.context().close();
});

const fill = async (current: string, next: string, again: string) => {
  await admin.locator("#current-password").fill(current);
  await admin.locator("#new-password").fill(next);
  await admin.locator("#confirm-password").fill(again);
  await admin.getByRole("button", { name: "Change password" }).click();
};

test("a wrong current password is refused in plain words, with no request id", async () => {
  await admin.goto("/account");
  await fill("Not-My-Current-Password-1", NEW_PASSWORD, NEW_PASSWORD);
  const alert = admin.getByRole("alert").filter({ hasText: /\S/ }).first();
  await expect(alert).toBeVisible();
  const text = await alert.innerText();
  expect(text).not.toMatch(/\(ref /i);
  expect(text).not.toMatch(/Exception/);
});

test("a confirmation that does not match, and a repetitive password, are refused", async () => {
  await admin.goto("/account");
  await fill(STAFF_PASSWORD, NEW_PASSWORD, "A-Different-Passphrase-3");
  const mismatch = admin.getByRole("alert").filter({ hasText: /\S/ }).first();
  await expect(mismatch).toBeVisible();
  expect(await mismatch.innerText()).not.toMatch(/\(ref /i);

  await admin.goto("/account");
  await fill(STAFF_PASSWORD, "aaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaa");
  const weak = admin.getByRole("alert").filter({ hasText: /\S/ }).first();
  await expect(weak).toBeVisible();
  expect(await weak.innerText()).not.toMatch(/\(ref /i);
});

test("the password changes and the other session is signed out", async ({ browser }) => {
  await admin.goto("/account");
  await fill(STAFF_PASSWORD, NEW_PASSWORD, NEW_PASSWORD);
  await toast(admin, "Password changed; your other sessions were signed out");
  // The fields are emptied and no error is left on screen.
  await expect(admin.locator("#current-password")).toHaveValue("");
  await expect(admin.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);

  // The other browser is sent to sign in at its next request.
  await other.goto("/account");
  await other.waitForURL(/\/login/);

  // The old password no longer signs in; the new one does.
  const old = await signIn(browser, STAFF_PASSWORD);
  expect(old.failed).toMatch(/invalid email or password/i);
  expect(old.failed).not.toMatch(/\(ref /i);
  await old.page.context().close();
  const fresh = await signIn(browser, NEW_PASSWORD);
  expect(fresh.failed).toBeNull();
  await fresh.page.goto("/account");
  await expect(fresh.page.getByRole("button", { name: "Change password" })).toBeVisible();
  await fresh.page.context().close();
  expect(errors).toEqual([]);
});
