import { expect, test } from "@playwright/test";
import { STAFF } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Offline capture and replay (ADR-0013): with the connection gone, the desk captures a registration, a walk-in
 * check-in for that patient and the patient's vital signs on the Offline page (served by the service worker after a
 * reload); when the connection returns the three are sent in order through the live routes, and the patient appears
 * on the queue, triaged.
 */
test("the desk captures a registration, a walk-in and vital signs offline and they are sent when the connection returns", async ({ browser }) => {
  const errors: string[] = [];
  const admin = await staffPage(browser, STAFF.admin, errors);
  const context = admin.context();

  // Open the Offline page once with a connection: the service worker keeps a copy, with today's visit types.
  await admin.goto("/offline");
  await expect(admin.getByRole("heading", { name: "Offline" })).toBeVisible();
  await expect(admin.getByText(/Connected\./)).toBeVisible();
  await admin.waitForFunction(() => navigator.serviceWorker?.controller !== null || navigator.serviceWorker?.ready !== undefined);
  await admin.waitForTimeout(1000);

  await context.setOffline(true);
  await admin.reload();
  // Both the banner and the page itself say so.
  await expect(admin.getByRole("status").filter({ hasText: "No connection" })).toHaveCount(2);

  await admin.getByLabel("Family name *").fill("Offline");
  await admin.getByLabel("Given name *").fill("Oscar");
  await admin.getByLabel("Sex *").selectOption("male");
  await admin.getByLabel("Birth date *").fill("1988-08-08");
  await admin.getByLabel("Mobile").fill("0917 888 1234");
  await admin.getByRole("button", { name: "Capture registration" }).click();
  await toast(admin, "Captured: OFFLINE, Oscar");

  await admin.getByLabel("Patient", { exact: true }).selectOption({ label: "OFFLINE, Oscar (registered here)" });
  await admin.getByLabel("Visit type *").selectOption({ label: "Consultation" });
  await admin.getByLabel("Chief complaint", { exact: true }).fill("Cough for three days");
  await admin.getByRole("button", { name: "Capture check-in" }).click();
  await toast(admin, "Captured: Walk-in · OFFLINE, Oscar");

  await admin.getByLabel("Visit *").selectOption({ label: "Walk-in · OFFLINE, Oscar (checked in here)" });
  await admin.getByLabel("Chief complaint *").fill("Cough for three days");
  await admin.getByLabel("Temperature (°C)").fill("37.9");
  await admin.getByLabel("Heart rate (/min)").fill("88");
  await admin.getByRole("button", { name: "Capture vital signs" }).click();
  await toast(admin, "Captured: Vitals · Walk-in · OFFLINE, Oscar");
  await expect(admin.getByText("3 waiting")).toBeVisible();

  await context.setOffline(false);
  await admin.getByRole("button", { name: "Send now" }).click();
  await toast(admin, "Sent: OFFLINE, Oscar");
  await toast(admin, "Sent: Walk-in · OFFLINE, Oscar");
  await toast(admin, "Sent: Vitals · Walk-in · OFFLINE, Oscar");
  await expect(admin.getByText(/patient no\. /)).toBeVisible();

  await admin.goto("/queue");
  await expect(admin.getByText("OFFLINE, Oscar")).toBeVisible();
  expect(errors).toEqual([]);
});
