import { expect, test } from "@playwright/test";
import { API_URL, STAFF_URL } from "../support/env";
import { watchErrors } from "../support/pages";

/**
 * The public landing page (`/welcome`): signed out, static, and it tells visitors about the patient self-service kiosk.
 */
const shots = process.env.E2E_KIOSK_SHOTS;

test("the public welcome page presents the kiosk, reachable from the menu, without calling the API", async ({ browser }) => {
  const errors: string[] = [];
  const context = await browser.newContext({ baseURL: STAFF_URL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watchErrors(page, "welcome", errors);
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(API_URL)) apiCalls.push(request.url());
  });
  try {
    await page.goto("/welcome");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("One patient");

    // From the menu to the section.
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Kiosk" }).click();
    await expect(page).toHaveURL(/#kiosk$/);
    const section = page.locator("#kiosk");
    await expect(section.getByRole("heading", { name: "Shorter lines at the front desk" })).toBeVisible();
    for (const title of [
      "Patients check themselves in",
      "New patients register at the kiosk",
      "A number on screen, or on paper",
      "A waiting-room screen that calls the number",
      "Private by design",
      "The same queue as the front desk",
    ]) {
      await expect(section.getByRole("heading", { name: title })).toBeVisible();
    }
    // The pictures are labelled as illustrations: no real patient, ticket or screen is shown.
    await expect(section.getByRole("img", { name: /Illustration of a kiosk ticket/ })).toBeVisible();
    await expect(section.getByText("Illustration")).toHaveCount(2);
    // The care journey mentions the kiosk too.
    await expect(page.getByText(/a self-service kiosk, reception scheduling/)).toBeVisible();
    if (shots) await section.screenshot({ path: `${shots}/welcome-kiosk.png` });

    // On a phone nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/welcome#kiosk");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    if (shots) await page.locator("#kiosk").screenshot({ path: `${shots}/welcome-kiosk-phone.png` });

    expect(apiCalls, "the public page never calls the API").toEqual([]);
  } finally {
    await context.close();
  }
  expect(errors, "console or page errors").toEqual([]);
});
