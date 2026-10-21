import { expect, type Page, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { STAFF } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Patient QR codes (migration 0117): the administrator turns them on; the front desk registers a patient and the code is
 * issued with the registration; the card is printed; a scan finds the patient; a lost card is revoked and its scans are
 * refused. Finally the administrator turns the feature off again so later journeys register as before.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];
const patient = { id: "", number: "", family: "Qrjourneyfamily", given: "Quentin" };
let payload = "";

let admin: Page;
let desk: Page;

const scan = async (page: Page, value: string) => {
  await page.goto("/patients/scan");
  await page.locator("#qr-scan-field").fill(value);
  await page.getByRole("button", { name: "Find" }).click();
};

test.beforeAll(async ({ browser }) => {
  admin = await staffPage(browser, STAFF.admin, errors);
  desk = await staffPage(browser, STAFF.desk, errors);
});

test.afterAll(async () => {
  await admin?.context().close();
  await desk?.context().close();
  expect(errors, "page errors and server errors during the journey").toEqual([]);
});

test("QR codes are off until the administrator turns them on", async () => {
  await desk.goto("/patients/new");
  await expect(desk.getByText("Issue a patient QR code")).toHaveCount(0);

  await admin.goto("/admin/patient-qr");
  await admin.getByLabel("Use patient QR codes").check();
  await expect(admin.getByLabel(/Issue a code when a patient is registered/)).toBeEnabled();
  await expect(admin.getByRole("radio", { name: /A random key/ })).toBeChecked();
  await admin.getByRole("button", { name: "Save settings" }).click();
  await toast(admin, "Settings saved");
});

test("the front desk registers a patient and a code is issued with the registration", async () => {
  await desk.goto("/patients/new");
  await expect(desk.getByLabel("Issue a patient QR code")).toBeChecked();
  await desk.locator("#familyName").fill(patient.family);
  await desk.locator("#givenName").fill(patient.given);
  await desk.locator("#sex").selectOption("male");
  await desk.locator("#birthDate").fill("1975-02-11");
  await desk.getByRole("button", { name: "Register patient" }).click();
  await desk.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
  patient.id = desk.url().split("/").pop()!;

  await desk.goto(`/patients/${patient.id}?tab=portal`);
  await expect(desk.getByRole("img", { name: "Patient QR code" })).toBeVisible();
  await expect(desk.getByRole("link", { name: "Print card" })).toHaveAttribute("href", `/patients/${patient.id}/qr/card.pdf`);
  await expect(desk.getByText(/It holds a random key only/)).toBeVisible();

  // The printed card is a PDF.
  const pdf = await desk.request.get(`/patients/${patient.id}/qr/card.pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  const api = await staffApi(STAFF.admin, state.facilityId);
  const qr = await api.get<{ active: { payload: string } }>(`/patient-qr/patients/${patient.id}`);
  await api.dispose();
  payload = qr.active.payload;
  expect(payload).toMatch(/^HPQ1:T:[A-Z2-7]{26}$/);
});

test("scanning the code finds the patient", async () => {
  await scan(desk, payload);
  await expect(desk.getByText(new RegExp(patient.family, "i")).first()).toBeVisible();
  await desk.getByRole("link", { name: "Open record" }).click();
  await desk.waitForURL(new RegExp(`/patients/${patient.id}$`));

  await scan(desk, "not a patient code");
  await expect(desk.locator("p[role=alert]")).toContainText("not a patient QR code");
});

test("a lost card is revoked and its scans are refused", async () => {
  await desk.goto(`/patients/${patient.id}?tab=portal`);
  await desk.getByRole("button", { name: "Revoke (lost card)…" }).click();
  await desk.locator("#qr-revoke-reason").fill("Card lost on the jeepney");
  await desk.getByRole("button", { name: "Revoke code" }).click();
  await toast(desk, "QR code revoked");
  await expect(desk.getByText("This patient has no active QR code.")).toBeVisible();

  await scan(desk, payload);
  await expect(desk.locator("p[role=alert]")).toContainText("revoked");

  await desk.goto(`/patients/${patient.id}?tab=portal`);
  await desk.getByRole("button", { name: "Issue QR code" }).click();
  await toast(desk, "QR code issued");
  await expect(desk.getByRole("img", { name: "Patient QR code" })).toBeVisible();
});

test("the administrator turns the feature off and scans are refused", async () => {
  await admin.goto("/admin/patient-qr");
  await admin.getByLabel("Use patient QR codes").uncheck();
  await admin.getByRole("button", { name: "Save settings" }).click();
  await toast(admin, "Settings saved");
  await scan(desk, payload);
  await expect(desk.locator("p[role=alert]")).toContainText("not turned on");
});
