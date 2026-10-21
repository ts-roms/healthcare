import { expect, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { STAFF } from "../support/env";
import { portalPage, staffPage } from "../support/pages";

/**
 * A conversation shows the other side's new message while the page is open, without a reload: the clinic sees the
 * patient's reply (pushed over the realtime socket) and the patient sees the clinic's (the page re-reads every few
 * seconds), each from a page that was already open.
 */
test("a message appears on the other side's open page without refreshing it", async ({ browser }) => {
  const errors: string[] = [];
  const state = loadState();
  const api = await staffApi(STAFF.admin, state.facilityId);
  const thread = await api.post<{ id: string }>("/patient-messages", {
    patientId: state.onlinePatient.id,
    topic: "general",
    subject: "Live conversation",
    body: "First message from the clinic.",
  });
  await api.dispose();

  const staff = await staffPage(browser, STAFF.admin, errors);
  await staff.goto(`/messages/${thread.id}`);
  const patient = await portalPage(browser, state.onlinePatient.email, errors);
  await patient.goto(`/messages/${thread.id}`);
  await expect(patient.getByText("First message from the clinic.")).toBeVisible();

  // The clinic replies: it shows on its own page at once, and on the patient's open page without a reload.
  await staff.getByLabel("Reply").fill("Second message from the clinic.");
  await staff.getByRole("button", { name: "Send reply" }).click();
  await expect(staff.getByRole("list", { name: "Messages" }).getByText("Second message from the clinic.")).toBeVisible();
  await expect(patient.getByText("Second message from the clinic.")).toBeVisible({ timeout: 30_000 });

  // The patient answers: the clinic's open page shows it without a reload.
  await patient.locator("textarea").first().fill("Third message from the patient.");
  await patient.getByRole("button", { name: /send/i }).first().click();
  await expect(staff.getByText("Third message from the patient.")).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
