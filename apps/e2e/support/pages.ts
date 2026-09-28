import { type Browser, expect, type Page } from "@playwright/test";
import { PATIENT_PASSWORD, PORTAL_URL, STAFF_PASSWORD, STAFF_URL } from "./env";

/** Collects uncaught page errors and server errors so a journey fails on them, not only on missing text. */
export function watchErrors(page: Page, who: string, errors: string[]): void {
  page.on("pageerror", (error) => errors.push(`${who} at ${new URL(page.url()).pathname}: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`${who}: ${response.status()} ${response.url()}`);
  });
}

/** Signs a staff user in (their own browser context) and selects the clinic in the top bar. */
export async function staffPage(browser: Browser, email: string, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ baseURL: STAFF_URL });
  const page = await context.newPage();
  watchErrors(page, email, errors);
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(STAFF_PASSWORD);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.getByRole("button", { name: /sign in/i }).click()]);
  const facility = page.getByLabel("Facility");
  if ((await facility.count()) && (await facility.inputValue()) === "") {
    await facility.selectOption({ label: "E2E Main Clinic" });
    await expect(facility).toHaveValue(/.+/);
    await page.waitForLoadState("networkidle");
  }
  return page;
}

/** Signs a patient in to MyHealth in their own browser context. */
export async function portalPage(browser: Browser, email: string, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ baseURL: PORTAL_URL, viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  watchErrors(page, email, errors);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PATIENT_PASSWORD);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.getByRole("button", { name: "Sign in" }).click()]);
  return page;
}

/** Waits for a toast (sonner) whose text matches. */
export async function toast(page: Page, text: string | RegExp): Promise<string> {
  const item = page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
  await expect(item).toBeVisible();
  return item.innerText();
}
