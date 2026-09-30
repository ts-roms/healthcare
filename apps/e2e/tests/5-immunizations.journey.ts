import { expect, test } from "@playwright/test";
import { loadState } from "../support/api";
import { STAFF } from "../support/env";
import { portalPage, staffPage, toast } from "../support/pages";

/**
 * Immunization history: the organization adds a vaccine to its own catalogue; the doctor records a dose given at the
 * clinic and a dose reported from the patient's vaccination card (year only); the patient sees both in MyHealth.
 */
test("a dose given and a reported dose reach the patient's immunization history in MyHealth", async ({ browser }) => {
  const state = loadState();
  const patient = state.onlinePatient;
  const errors: string[] = [];

  const admin = await staffPage(browser, STAFF.admin, errors);
  await admin.goto("/clinic/vaccines");
  await admin.getByLabel("Name *").fill("Influenza vaccine");
  await admin.getByLabel("Routes (one per line)").fill("Intramuscular");
  await admin.getByRole("button", { name: "Add vaccine" }).click();
  await toast(admin, "Influenza vaccine added");
  await expect(admin.getByRole("cell", { name: /Influenza vaccine/ })).toBeVisible();

  // The same signed-in administrator records the doses (organization administrators hold immunization.record); one
  // sign-in keeps the run under the sign-in rate limit.
  const doctor = admin;
  await doctor.goto(`/patients/${patient.id}/immunizations`);
  await expect(doctor.getByText("No immunizations recorded.")).toBeVisible();
  await doctor.getByRole("button", { name: "Record dose given here" }).click();
  await doctor.getByLabel("Vaccine *").selectOption({ label: "Influenza vaccine" });
  await doctor.getByLabel("Lot number *").fill("FLU-E2E-1");
  await doctor.getByLabel("Route").selectOption("Intramuscular");
  await doctor.getByRole("button", { name: "Record dose given" }).click();
  await toast(doctor, "Dose recorded: Influenza vaccine");
  await expect(doctor.getByText(/Lot FLU-E2E-1/)).toBeVisible();

  await doctor.getByRole("button", { name: "Record reported dose" }).click();
  await doctor.getByLabel("Vaccine as written on the source").fill("Measles-containing vaccine");
  await doctor.getByLabel("When given *").fill("2015");
  await doctor.getByRole("button", { name: "Record reported dose" }).click();
  await toast(doctor, "Reported dose recorded: Measles-containing vaccine");
  await expect(doctor.getByRole("region", { name: "Measles-containing vaccine" })).toContainText("2015");

  const me = await portalPage(browser, patient.email, errors);
  await me.goto("/immunizations");
  await expect(me.getByRole("heading", { name: "Your immunizations" })).toBeVisible();
  await expect(me.getByRole("region", { name: "Influenza vaccine" })).toContainText("Given at our clinic");
  await expect(me.getByRole("region", { name: "Measles-containing vaccine" })).toContainText("2015");
  await expect(me.getByText("FLU-E2E-1")).toHaveCount(0);
  expect(errors).toEqual([]);
});
