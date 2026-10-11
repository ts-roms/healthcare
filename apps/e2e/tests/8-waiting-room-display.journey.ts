import { expect, test } from "@playwright/test";
import { STAFF } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * The waiting-room display (migration 0112): a screen signed in with the display account shows the ticket reception
 * calls and where to go, live — and never the patient's name.
 */
test("reception calls a ticket and the waiting-room display shows it, without the patient's name", async ({ browser }) => {
  const errors: string[] = [];
  const screen = await staffPage(browser, STAFF.display, errors);
  // The display account lands on the display and nowhere else.
  await screen.waitForURL(/\/display\/queue$/);
  await expect(screen.getByRole("heading", { name: "E2E Main Clinic" })).toBeVisible();
  await expect(screen.getByText("Live")).toBeVisible();
  await screen.goto("/patients");
  await screen.waitForURL(/\/display\/queue$/);

  const desk = await staffPage(browser, STAFF.desk, errors);
  await desk.goto("/patients/new");
  await desk.locator("#familyName").fill("Display");
  await desk.locator("#givenName").fill("Teodoro");
  await desk.locator("#sex").selectOption("male");
  await desk.locator("#birthDate").fill("1968-02-03");
  await desk.getByRole("button", { name: "Register patient" }).click();
  await desk.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
  const patientId = desk.url().split("/").pop()!;

  await desk.goto(`/queue/walk-in?patientId=${patientId}`);
  await desk.locator("#visitType").selectOption({ label: "Consultation" });
  await desk.getByRole("button", { name: "Check in" }).click();
  const ticket = /ticket (A-\d{3})/.exec(await toast(desk, /Checked in — ticket A-\d{3}/))![1]!;
  await desk.waitForURL(/\/queue$/);
  await desk
    .getByText(/DISPLAY, Teodoro/i)
    .first()
    .click();
  await desk.locator("#called-to").fill("Room 5");
  await desk.getByRole("button", { name: "Call" }).click();
  await toast(desk, `${ticket} called to Room 5`);

  // Live: the call reaches the screen without reloading it.
  const nowCalling = screen.getByRole("region", { name: "Now calling" });
  await expect(nowCalling.getByText(ticket, { exact: true })).toBeVisible();
  await expect(nowCalling.getByText("Room 5")).toBeVisible();
  await expect(screen.getByText(/Teodoro|DISPLAY,/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
