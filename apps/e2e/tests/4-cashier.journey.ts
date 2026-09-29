import { expect, test } from "@playwright/test";
import { STAFF } from "../support/env";
import { staffPage } from "../support/pages";

/** A cashier-only user (no organization.read) chooses the clinic in the top bar and works at the cashier's desk. */
test("a cashier selects the clinic and opens the cashier's desk", async ({ browser }) => {
  const errors: string[] = [];
  const cashier = await staffPage(browser, STAFF.cashier, errors);
  await expect(cashier.getByLabel("Facility")).toHaveValue(/.+/);
  await cashier.goto("/billing");
  await expect(cashier.getByText("E2E Main Clinic · charges to invoice")).toBeVisible();
  await expect(cashier.getByText("Select your facility in the top bar first.")).toHaveCount(0);
  expect(errors).toEqual([]);
});
