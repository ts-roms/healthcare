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

  test("the facility set-up guide and the kiosk set-up guide are in the manual, and the index leads to them", async ({ browser }) => {
    const admin = await staffPage(browser, STAFF.admin, errors);
    await admin.goto("/help");
    await admin.getByRole("link", { name: "Administration → set up a facility" }).click();
    await admin.waitForURL(/\/help\/administration#how-to-set-up-a-facility-its-type-and-what-it-needs/);
    const article = admin.locator("article");
    await expect(article.getByRole("heading", { name: "How to set up a facility: its type and what it needs" })).toBeVisible();
    // The eight types, what is required, the checklist and the licences the platform keeps.
    for (const type of ["Clinic", "Laboratory", "Dental clinic", "Hospital", "Diagnostic center", "Telemedicine hub", "Pharmacy", "Other"]) {
      await expect(article.getByRole("cell", { name: type, exact: true }).first()).toBeVisible();
    }
    await expect(article.getByRole("heading", { name: "What the facility type is (and is not)" })).toBeVisible();
    await expect(article.getByRole("heading", { name: "Checklist: setting up a new facility" })).toBeVisible();
    await expect(article.getByRole("heading", { name: "Licences and accreditations the platform keeps (as issued, never checked)" })).toBeVisible();
    await expect(article.getByText("The type is a label.")).toBeVisible();
    if (process.env.E2E_KIOSK_SHOTS) {
      const table = article.getByRole("heading", { name: "What each kind of facility needs" });
      await table.scrollIntoViewIfNeeded();
      await admin.screenshot({ path: `${process.env.E2E_KIOSK_SHOTS}/help-facility-types.png` });
    }

    await admin.goto("/help/appointments-and-queue");
    await expect(admin.locator("article").getByRole("heading", { name: "How to set up a patient kiosk" })).toBeVisible();
    await admin.context().close();
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
