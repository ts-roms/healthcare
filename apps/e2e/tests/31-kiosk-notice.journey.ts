import { expect, test } from "@playwright/test";
import { loadState } from "../support/api";
import { portalPage } from "../support/pages";

/**
 * MyHealth's home page tells patients that the clinic has self-service kiosks (only when one is in service), says how to use
 * one, and lets the patient hide the notice for good in their browser.
 */
const state = loadState();
const shots = process.env.E2E_KIOSK_SHOTS;

test("the home page tells patients about the kiosk, and the patient can hide the notice", async ({ browser }) => {
  const errors: string[] = [];
  const page = await portalPage(browser, state.onlinePatient.email, errors);
  try {
    await page.goto("/");
    const notice = page.getByRole("region", { name: "Skip the front desk line" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("E2E Main Clinic");
    await expect(notice.getByRole("listitem")).toHaveCount(3);
    await expect(notice).toContainText("patient number or mobile number");
    // It names no patient and no visit.
    await expect(notice).not.toContainText(/Reyes/i);
    if (shots) await page.screenshot({ path: `${shots}/home-kiosk-notice.png`, fullPage: true });

    await notice.getByRole("button", { name: "Hide this notice" }).click();
    await expect(notice).toHaveCount(0);
    // Hidden for good in this browser.
    await page.reload();
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Skip the front desk line" })).toHaveCount(0);
  } finally {
    await page.context().close();
  }
  expect(errors, "console or page errors").toEqual([]);
});
