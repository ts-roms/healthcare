import { type Browser, expect, type Locator, type Page } from "@playwright/test";
import { PATIENT_PASSWORD, PORTAL_URL, STAFF_PASSWORD, STAFF_URL } from "./env";

/**
 * Waits until React has attached to the page's controls. `goto` and `waitForURL` return once the document has loaded, but
 * the controls below the fold hydrate a moment later and a click or a form submit before then is lost (the journeys'
 * intermittent failures). Markup that React does not own (rendered manual text, for example) never hydrates, so the wait
 * is capped and a page that does not settle is used as it is.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const controls = Array.from(document.querySelectorAll("button, a[href], input, select, textarea"));
        return controls.length > 0 && controls.every((el) => Object.keys(el).some((key) => key.startsWith("__reactProps")));
      },
      undefined,
      { timeout: 3_000 },
    )
    .catch(() => undefined);
}

/** Makes `goto` and `waitForURL` return only after the page has hydrated. */
function settleAfterNavigation(page: Page): void {
  const goto = page.goto.bind(page);
  page.goto = (async (...args: Parameters<Page["goto"]>) => {
    // A navigation can be aborted by the app's own redirect landing at the same moment (a page that sends a member
    // without access home): the destination is still wanted, so go there once more after the page has settled.
    const response = await goto(...args).catch(async (error: unknown) => {
      if (!String(error).includes("ERR_ABORTED")) throw error;
      await page.waitForLoadState("load");
      return goto(...args);
    });
    await waitForHydration(page);
    return response;
  }) as Page["goto"];
  const waitForURL = page.waitForURL.bind(page);
  page.waitForURL = (async (...args: Parameters<Page["waitForURL"]>) => {
    await waitForURL(...args);
    await waitForHydration(page);
  }) as Page["waitForURL"];
}

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
  // The API allows 10 credential attempts a minute per client; a run of several journeys can hit that at a later
  // sign-in. A refused attempt shows an alert on the form: wait out the window once and try again.
  for (let attempt = 1; ; attempt += 1) {
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(STAFF_PASSWORD);
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
    if (outcome === "signed-in") break;
    const message = outcome === "refused" ? await page.getByRole("alert").filter({ hasText: /\S/ }).first().innerText() : "no answer";
    if (attempt >= 2 || !/too many|rate|limit|try again/i.test(message)) throw new Error(`Sign-in as ${email} failed: ${message}`);
    await page.waitForTimeout(61_000);
    await page.goto("/login");
  }
  settleAfterNavigation(page);
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
  await page.getByLabel("Password", { exact: true }).fill(PATIENT_PASSWORD);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.getByRole("button", { name: "Sign in" }).click()]);
  settleAfterNavigation(page);
  return page;
}

/** Waits for a toast (sonner) whose text matches. */
export async function toast(page: Page, text: string | RegExp): Promise<string> {
  const item = page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
  await expect(item).toBeVisible();
  return item.innerText();
}

/**
 * Clicks a button until what it opens is on screen. A click on a freshly loaded page can land before the page has
 * hydrated and do nothing; the next one works. Safe to repeat: once the expected element is visible nothing is clicked.
 */
export async function clickUntilVisible(button: Locator, expected: Locator, timeout = 20_000): Promise<void> {
  await expect(async () => {
    if (await expected.isVisible()) return;
    await button.click({ timeout: 2_000 });
    await expect(expected).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout });
}
