import { expect, test } from "@playwright/test";
import { PORTAL_URL, STAFF } from "../support/env";
import { staffPage, watchErrors } from "../support/pages";

/** The user manual in the apps: staff open Help from the menu; patients read the MyHealth guide before signing in. */
test.describe("help", () => {
  const errors: string[] = [];

  test.afterAll(() => {
    expect(errors, "page errors and server errors while reading help").toEqual([]);
  });

  test("staff open the manual from the menu and follow a link between chapters", async ({ browser }) => {
    const desk = await staffPage(browser, STAFF.desk, errors);
    await desk.getByRole("link", { name: "Help" }).first().click();
    await desk.waitForURL("**/help");
    await expect(desk.getByRole("heading", { name: "Chapters" })).toBeVisible();

    await desk
      .getByRole("navigation", { name: "Manual chapters" })
      .getByRole("link", { name: /Appointments and queue/ })
      .click();
    await desk.waitForURL("**/help/appointments-and-queue");
    await expect(desk.getByRole("heading", { level: 1, name: "3. Appointments and queue" })).toBeVisible();
    await expect(desk.locator("article table").first()).toBeVisible();

    await desk.goto("/help/patients");
    await desk
      .locator("article")
      .getByRole("link", { name: /Getting started/ })
      .first()
      .click();
    await desk.waitForURL("**/help/getting-started");
  });

  test("patients read the MyHealth guide from the sign-in page, without the staff sections", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: PORTAL_URL, viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    watchErrors(page, "patient", errors);
    await page.goto("/login");
    await page.getByRole("link", { name: "How to use MyHealth" }).click();
    await page.waitForURL("**/help");
    await expect(page.getByRole("heading", { level: 1, name: "How to use MyHealth" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How to set up your account (first time)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "For clinic staff" })).toHaveCount(0);
    await context.close();
  });
});
