import { expect, type Page, test } from "@playwright/test";
import { DOCTOR_NAME, PATIENT_PASSWORD, PORTAL_URL, STAFF } from "../support/env";
import { staffPage, toast, watchErrors } from "../support/pages";

/**
 * CLAUDE.md §31 critical journey 1, through the staff app and MyHealth:
 * registration → appointment → check-in → consultation → laboratory order → specimen collection → result → approval
 * → release → patient portal. Each person works in their own browser session with their own role.
 */
test.describe.configure({ mode: "serial" });

const patient = { familyName: "Bautista", givenName: "Carmen", birthDate: "1975-04-12", mobile: "0917 555 0199", email: "carmen.bautista@e2e.ph" };

test.describe("registration to laboratory result in MyHealth", () => {
  const errors: string[] = [];
  let desk: Page;
  let patientId = "";
  let accession = "";

  test.beforeAll(async ({ browser }) => {
    desk = await staffPage(browser, STAFF.desk, errors);
  });

  test.afterAll(() => {
    expect(errors, "page errors and server errors during the journey").toEqual([]);
  });

  test("the front desk registers the patient", async () => {
    await desk.goto("/patients/new");
    await desk.locator("#familyName").fill(patient.familyName);
    await desk.locator("#givenName").fill(patient.givenName);
    await desk.locator("#sex").selectOption("female");
    await desk.locator("#birthDate").fill(patient.birthDate);
    await desk.locator("#mobile").fill(patient.mobile);
    await desk.getByRole("button", { name: "Register patient" }).click();
    await desk.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    patientId = desk.url().split("/").pop()!;
    await expect(desk.getByText(/BAUTISTA, Carmen/i).first()).toBeVisible();
  });

  test("books today's appointment and checks the patient in", async () => {
    await desk.getByRole("link", { name: "Book appointment" }).click();
    // Each choice reloads the open slots through the URL.
    await desk.locator("#practitioner").selectOption({ label: DOCTOR_NAME });
    await desk.waitForURL(/practitionerId=/);
    await desk.locator("#visitType").selectOption({ label: "Consultation · 15 min" });
    await desk.waitForURL(/visitTypeId=/);
    await desk.locator("#reason").fill("Frequent thirst and urination");
    await desk.getByRole("radiogroup", { name: "Open slots" }).getByRole("radio").first().click();
    await desk.getByRole("button", { name: /^Book \d/ }).click();
    await toast(desk, /Booked BAUTISTA, Carmen/i);
    await desk.waitForURL(/\/appointments\?/);
    await desk.getByRole("button", { name: "Check in" }).click();
    await toast(desk, /Checked in .* ticket/);
  });

  test("the doctor sees the patient, orders a test and signs", async ({ browser }) => {
    const doctor = await staffPage(browser, STAFF.doctor, errors);
    // The visit type needs no triage: the patient waits on the queue board until the doctor starts the consultation.
    await doctor.goto("/queue");
    await doctor
      .getByText(/BAUTISTA, Carmen/i)
      .first()
      .click();
    await doctor.getByRole("button", { name: "Start consultation" }).click();
    await doctor.waitForURL(/\/clinic\/encounters\/[0-9a-f-]{36}$/);

    await doctor.getByLabel("Subjective", { exact: true }).fill("Polydipsia and polyuria for two months. No weight loss.");
    await doctor.getByLabel("Assessment", { exact: true }).fill("Probable type 2 diabetes mellitus.");
    await doctor.getByLabel("Plan", { exact: true }).fill("Fasting blood sugar today; review with the result.");

    await doctor.getByRole("button", { name: "Add diagnosis" }).click();
    await doctor.locator("#dx-display").fill("Type 2 diabetes mellitus without complications");
    await doctor.locator("#dx-code").fill("E11.9");
    await doctor.getByRole("button", { name: "Add diagnosis" }).click();
    await toast(doctor, /Diagnosis added/);

    await doctor.getByRole("button", { name: "Order tests" }).click();
    await doctor.getByLabel("Fasting blood sugar").check();
    await doctor.getByRole("button", { name: /^Order 1 test/ }).click();
    await toast(doctor, /sent to the laboratory/);

    await doctor.getByRole("button", { name: "Sign encounter" }).click();
    await toast(doctor, "Encounter signed");
    await doctor.context().close();
  });

  test("the laboratory collects, receives and enters the result", async ({ browser }) => {
    const medtech = await staffPage(browser, STAFF.medtech, errors);
    await medtech.goto("/laboratory/worklist?stage=collect");
    await medtech.getByRole("button", { name: /Collect serum/ }).click();
    accession = (await toast(medtech, /Label the tube: \d+/)).match(/Label the tube: (\d+)/)![1]!;

    await medtech.goto("/laboratory/worklist?stage=receive");
    await medtech.getByRole("button", { name: "Receive specimen" }).click();
    await toast(medtech, /Specimen received/);

    await medtech.goto("/laboratory/worklist?stage=enter");
    const scan = medtech.getByLabel("Scan accession barcode");
    await scan.fill(accession);
    await scan.press("Enter");
    // The scanned specimen opens once the lookup finishes (the field clears).
    await expect(scan).toHaveValue("");
    await expect(scan).toBeEnabled();
    await medtech.getByLabel("Fasting blood sugar", { exact: true }).fill("7.2");
    await medtech.getByRole("button", { name: /^Save 1 result/ }).click();
    await toast(medtech, "1 result entered");
    await medtech.context().close();
  });

  test("the pathologist verifies, approves and releases it", async ({ browser }) => {
    const pathologist = await staffPage(browser, STAFF.pathologist, errors);
    for (const [stage, action] of [
      ["verify", "Verify"],
      ["approve", "Approve"],
      ["release", "Release"],
    ] as const) {
      await pathologist.goto(`/laboratory/worklist?stage=${stage}`);
      await pathologist.getByRole("button", { name: action, exact: true }).click();
      await toast(pathologist, `Fasting blood sugar: ${action.toLowerCase()}d`);
    }
    await pathologist.context().close();
  });

  test("the front desk enrolls the patient in MyHealth", async () => {
    await desk.goto(`/patients/${patientId}`);
    await desk.getByRole("button", { name: "Record consent" }).click();
    await desk.locator("#consent-type").selectOption({ label: "Patient portal access (MyHealth)" });
    await desk.getByLabel("Granted").check();
    await desk.getByRole("button", { name: "Save consent" }).click();
    await toast(desk, /Patient portal access \(MyHealth\): granted/);
    await desk.getByRole("button", { name: "Invite to portal" }).click();
    await expect(desk.getByText("Activation code — shown only once")).toBeVisible();
  });

  test("the patient activates MyHealth and sees the released result", async ({ browser }) => {
    const code = (await desk.getByText("Activation code — shown only once").locator("xpath=following-sibling::p[1]").innerText()).trim();
    const patientNumber = (
      await desk
        .locator("span.font-mono")
        .filter({ hasText: /^P\d+$/ })
        .first()
        .innerText()
    ).trim();

    const context = await browser.newContext({ baseURL: PORTAL_URL, viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true });
    const me = await context.newPage();
    watchErrors(me, "patient", errors);
    await me.goto("/activate");
    await me.getByLabel("Patient number").fill(patientNumber);
    await me.getByLabel("Date of birth").fill(patient.birthDate);
    await me.getByLabel("Activation code").fill(code);
    await me.getByLabel("Email").fill(patient.email);
    await me.getByLabel("New password").fill(PATIENT_PASSWORD);
    await me.getByLabel("Type the password again").fill(PATIENT_PASSWORD);
    await me.getByRole("button", { name: "Set up and sign in" }).click();
    await me.waitForURL(/\/\?welcome=1$/);

    await me.goto("/results");
    await expect(me.getByRole("heading", { name: "Your results" })).toBeVisible();
    await expect(me.getByText("Fasting blood sugar").first()).toBeVisible();
    await expect(me.getByText("7.2").first()).toBeVisible();
    await context.close();
  });
});
