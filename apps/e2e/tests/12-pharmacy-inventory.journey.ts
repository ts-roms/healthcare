import { expect, type Page, test } from "@playwright/test";
import { manilaDate, staffApi } from "../support/api";
import { STAFF, STAFF_PASSWORD } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Inventory purchasing and pharmacy dispensing: a purchase order is drafted and submitted by one person and approved by
 * another, its delivery is received into stock by lot and expiry (never above what was ordered), the pharmacist then
 * dispenses an active prescription from that stock (first-expiry-first-out, never more than prescribed), and a mistaken
 * dispense is reversed once with a reason, returning the same lots.
 */
test.describe.configure({ mode: "serial" });

const errors: string[] = [];

const ITEM = "Paracetamol 500 mg tablet";
const LOCATION = "Main pharmacy";
const SUPPLIER = "Mercury Pharma Supply";
const LATE_EXPIRY = manilaDate(400);
const EARLY_EXPIRY = manilaDate(200);

let admin: Page;
let approver: Page;
let pharmacist: Page;

const ids = { facilityId: "", locationId: "", itemId: "", patientId: "", prescriptionId: "", prescriptionNumber: "", poUrl: "" };
const patient = { family: "Pharmaquine", given: "Lourdes" };
const patientName = `${patient.family}, ${patient.given}`;

const stockRow = (page: Page) => page.getByRole("row").filter({ hasText: ITEM }).filter({ hasText: LOCATION });

test.beforeAll(async ({ browser }) => {
  // The facility is read from the API (not the shared seed file) so the journey depends only on its own database.
  const bootstrap = await staffApi(STAFF.admin);
  const [facility] = await bootstrap.get<Array<{ id: string }>>("/facilities");
  ids.facilityId = facility!.id;
  await bootstrap.dispose();
  const api = await staffApi(STAFF.admin, ids.facilityId);

  const location = await api.post<{ id: string }>("/inventory/locations", { facilityId: ids.facilityId, code: "pharmacy", name: LOCATION });
  ids.locationId = location.id;
  const item = await api.post<{ id: string }>("/inventory/items", {
    code: "paracetamol-500",
    name: ITEM,
    category: "medicine",
    stockUnit: "tablet",
    tracksLots: true,
    controlled: false,
  });
  ids.itemId = item.id;
  await api.post("/inventory/suppliers", { code: "mercury", name: SUPPLIER });

  // A second person who can approve (the submitter never approves their own order).
  const roles = await api.get<Array<{ id: string; key: string }>>("/roles");
  const created = await api.post<{ id: string }>("/users", {
    email: "approver@e2e.ph",
    displayName: "Alma Approver",
    initialPassword: STAFF_PASSWORD,
  });
  await api.post(`/users/${created.id}/role-assignments`, { roleId: roles.find((r) => r.key === "org_admin")!.id });

  // A patient with an active prescription written by the doctor in a consultation.
  const created2 = await api.post<{ id: string }>("/patients", {
    familyName: patient.family,
    givenName: patient.given,
    sex: "female",
    birthDate: "1979-11-02",
    contacts: [{ system: "mobile", value: "0917 555 0612" }],
  });
  ids.patientId = created2.id;
  await api.dispose();

  const doctor = await staffApi(STAFF.doctor, ids.facilityId);
  const encounter = await doctor.post<{ id: string }>("/encounters", {
    patientId: ids.patientId,
    modality: "in_person",
    chiefComplaint: "Fever and body aches",
  });
  const prescription = await doctor.post<{ id: string; prescriptionNumber: string }>("/prescriptions", {
    encounterId: encounter.id,
    items: [
      {
        genericName: "Paracetamol",
        strength: "500 mg",
        dosageForm: "tablet",
        doseAmount: 1,
        doseUnit: "tablet",
        route: "oral",
        frequency: "every_6_hours",
        durationValue: 5,
        durationUnit: "days",
        quantity: 20,
        quantityUnit: "tablet",
        refills: 0,
        instructions: "One tablet every six hours for fever.",
      },
    ],
  });
  ids.prescriptionId = prescription.id;
  ids.prescriptionNumber = prescription.prescriptionNumber;
  await doctor.dispose();

  admin = await staffPage(browser, STAFF.admin, errors);
  approver = await staffPage(browser, "approver@e2e.ph", errors);
  pharmacist = await staffPage(browser, STAFF.pharmacist, errors);
});

test.afterAll(async () => {
  await admin?.context().close();
  await approver?.context().close();
  await pharmacist?.context().close();
});

test("a purchase order is drafted and submitted, and its submitter cannot approve it", async () => {
  await admin.goto("/inventory/purchase-orders");
  await admin.locator("#po-supplier").selectOption({ label: SUPPLIER });
  await admin.locator("#po-location").selectOption({ label: LOCATION });
  await admin.locator("#po-item-0").selectOption({ label: ITEM });
  await admin.locator("#po-qty-0").fill("50");
  await admin.locator("#po-cost-0").fill("1.50");
  await admin.getByRole("button", { name: "Save draft" }).click();
  await toast(admin, "Purchase order drafted");
  await admin.waitForURL(/\/inventory\/purchase-orders\/[0-9a-f-]{36}$/);
  ids.poUrl = new URL(admin.url()).pathname;
  await expect(admin.getByText("Draft", { exact: true }).first()).toBeVisible();

  await admin.getByRole("button", { name: "Submit for approval" }).click();
  await toast(admin, "Submitted for approval");
  await expect(admin.getByText("Awaiting approval").first()).toBeVisible();
  await expect(admin.getByText("You submitted this order; someone else approves it.")).toBeVisible();
  await expect(admin.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  // Nothing arrives until it is approved.
  await expect(admin.getByRole("button", { name: /^Receive into/ })).toHaveCount(0);
});

test("another person approves it, and a delivery is received by lot and expiry, never above what was ordered", async () => {
  await approver.goto(ids.poUrl);
  await expect(approver.getByText("Awaiting approval").first()).toBeVisible();
  await approver.getByRole("button", { name: "Approve", exact: true }).click();
  await toast(approver, "Purchase order approved");
  await expect(approver.getByText("Approved", { exact: true }).first()).toBeVisible();

  // First delivery: 30 tablets of the later-expiring lot.
  await approver.getByLabel("Delivery receipt / invoice no.").fill("DR-1001");
  await approver.getByLabel("Arrived").fill("30");
  await approver.getByLabel("Lot no.").fill("LOT-LATE");
  await approver.getByLabel("Expiry").fill(LATE_EXPIRY);
  await approver.getByRole("button", { name: `Receive into ${LOCATION}` }).click();
  await toast(approver, "Delivery received into stock");
  await expect(approver.getByText("Partly received").first()).toBeVisible();
  await expect(approver.getByText("20 to come").first()).toBeVisible();

  // More than the 20 still to come is refused, and nothing is received.
  await approver.getByLabel("Delivery receipt / invoice no.").fill("DR-1002");
  await approver.getByLabel("Arrived").fill("25");
  await approver.getByLabel("Lot no.").fill("LOT-EARLY");
  await approver.getByLabel("Expiry").fill(EARLY_EXPIRY);
  await approver.getByRole("button", { name: `Receive into ${LOCATION}` }).click();
  const refusal = approver.locator("[data-sonner-toast]").filter({ hasNotText: "Delivery received into stock" }).first();
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("only 20 still expected on this order");
  await expect(approver.getByText("Partly received").first()).toBeVisible();

  // The rest, with the earlier expiry.
  await approver.getByLabel("Arrived").fill("20");
  await approver.getByRole("button", { name: `Receive into ${LOCATION}` }).click();
  await toast(approver, "Delivery received into stock");
  await expect(approver.getByText("Received", { exact: true }).first()).toBeVisible();
  await expect(approver.getByRole("button", { name: /^Receive into/ })).toHaveCount(0);
});

test("the delivery appears in stock by lot and expiry, and in the movements", async () => {
  await admin.goto("/inventory");
  const row = stockRow(admin);
  await expect(row).toContainText("50 tablet");
  await expect(row).toContainText("LOT-LATE");
  await expect(row).toContainText("× 30");
  await expect(row).toContainText("LOT-EARLY");
  await expect(row).toContainText("× 20");
  await expect(row).toContainText("In stock");

  await admin.goto("/inventory/movements");
  const receipts = admin.getByRole("row").filter({ hasText: ITEM }).filter({ hasText: "Received" }).filter({ hasText: "Purchase order delivery" });
  await expect(receipts).toHaveCount(2);
  await expect(receipts.filter({ hasText: "LOT-LATE" })).toContainText("+30");
  await expect(receipts.filter({ hasText: "LOT-EARLY" })).toContainText("+20");
});

test("the pharmacist finds the prescription and dispenses from the earliest-expiring lot, never more than prescribed", async () => {
  await pharmacist.goto("/pharmacy");
  await expect(pharmacist.getByText("Nothing dispensed here today.")).toBeVisible();
  await pharmacist.getByLabel("Prescription number").fill(ids.prescriptionNumber);
  await pharmacist.getByRole("button", { name: "Find" }).click();
  await pharmacist.waitForURL(new RegExp(`/pharmacy/${ids.prescriptionId}$`));
  await expect(pharmacist.getByRole("heading", { name: `Prescription ${ids.prescriptionNumber}` })).toBeVisible();
  await expect(pharmacist.getByText(patientName, { exact: false }).first()).toBeVisible();
  await expect(pharmacist.getByText("Dispensed: nothing yet")).toBeVisible();

  const stock = pharmacist.locator("select[id^=dispense-stock-]");
  const quantity = pharmacist.locator("input[id^=dispense-qty-]");
  await stock.selectOption(`${ids.locationId}|${ids.itemId}`);

  // More than the 20 prescribed is refused with the message the screen shows.
  await quantity.fill("25");
  await pharmacist.getByRole("button", { name: /^Dispense 1 item/ }).click();
  await toast(pharmacist, /prescribed|more than|exceed|remaining|left/i);
  await expect(pharmacist.getByText("Nothing dispensed yet.")).toBeVisible();

  await quantity.fill("12");
  await pharmacist.getByRole("button", { name: /^Dispense 1 item/ }).click();
  await toast(pharmacist, "Dispensed; stock updated");
  await expect(pharmacist.getByText(/Dispensed:\s*12/)).toBeVisible();
  await expect(pharmacist.getByText(/8 tablet left/)).toBeVisible();
  await expect(pharmacist.getByText(`${ITEM} × 12`)).toBeVisible();

  // Further than what is left is refused too.
  await stock.selectOption(`${ids.locationId}|${ids.itemId}`);
  await quantity.fill("9");
  await pharmacist.getByRole("button", { name: /^Dispense 1 item/ }).click();
  await toast(pharmacist, /prescribed|more than|exceed|remaining|left/i);

  await pharmacist.goto("/pharmacy");
  const today = pharmacist.getByRole("row").filter({ hasText: patientName });
  await expect(today).toContainText(ITEM);
  await expect(today).toContainText("12");
});

test("stock went down from the earliest-expiring lot, and the movement is recorded", async () => {
  await pharmacist.goto("/inventory");
  const row = stockRow(pharmacist);
  await expect(row).toContainText("38 tablet");
  await expect(row).toContainText("LOT-EARLY");
  await expect(row).toContainText("× 8");
  await expect(row).toContainText("LOT-LATE");
  await expect(row).toContainText("× 30");

  await pharmacist.goto("/inventory/movements");
  const issue = pharmacist.getByRole("row").filter({ hasText: "Issued" }).filter({ hasText: "Pharmacy dispense" });
  await expect(issue).toHaveCount(1);
  await expect(issue).toContainText(ITEM);
  await expect(issue).toContainText("LOT-EARLY");
  await expect(issue).toContainText("-12");
});

test("a mistaken dispense is reversed with a reason, once, and the same lot gets the tablets back", async () => {
  await pharmacist.goto(`/pharmacy/${ids.prescriptionId}`);
  await pharmacist.getByRole("button", { name: "Reverse…" }).click();
  const submit = pharmacist.getByRole("button", { name: "Reverse dispense" });
  await expect(submit).toBeDisabled();
  await pharmacist.getByLabel("Why is it reversed?").fill("Handed over to the wrong patient");
  await submit.click();
  await toast(pharmacist, "Dispense reversed; stock returned");
  await expect(pharmacist.getByText("Reversed · Handed over to the wrong patient")).toBeVisible();
  // Once: no further reversal is offered, and the prescription shows nothing dispensed again.
  await expect(pharmacist.getByRole("button", { name: "Reverse…" })).toHaveCount(0);
  await expect(pharmacist.getByText(/Dispensed:\s*nothing yet/)).toBeVisible();

  await pharmacist.goto("/inventory");
  const row = stockRow(pharmacist);
  await expect(row).toContainText("50 tablet");
  await expect(row).toContainText("× 20");
  await expect(row).toContainText("× 30");

  await pharmacist.goto("/inventory/movements");
  const back = pharmacist.getByRole("row").filter({ hasText: ITEM }).filter({ hasText: "Pharmacy dispense" });
  await expect(back).toHaveCount(2);
  await expect(back.filter({ hasText: "Returned unused" })).toContainText("+12");
  await expect(back.filter({ hasText: "Returned unused" })).toContainText("LOT-EARLY");
});

test("a reorder level raises the low-stock indicator, and nothing broke along the way", async () => {
  const api = await staffApi(STAFF.admin, ids.facilityId);
  await api.post("/inventory/issues", {
    locationId: ids.locationId,
    itemId: ids.itemId,
    quantity: 45,
    issuedTo: "Ward supplies",
    reason: "Stock for the ward",
    idempotencyKey: "e2e-ward-issue-0001",
  });
  await api.dispose();
  await admin.goto("/inventory/catalog");
  await admin.locator("#rl-location").selectOption({ label: LOCATION });
  await admin.locator("#rl-item").selectOption({ label: ITEM });
  await admin.locator("#rl-level").fill("20");
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  await toast(admin, "Reorder level saved");

  // 5 tablets left, at or below the level of 20.
  await admin.goto("/inventory?show=low");
  await expect(stockRow(admin)).toContainText("5 tablet");
  await expect(stockRow(admin)).toContainText("Low");
  await admin.goto("/inventory/purchase-orders");
  await expect(admin.getByText("To reorder").locator("..").locator("..").getByText(ITEM)).toBeVisible();
  expect(errors).toEqual([]);
});
