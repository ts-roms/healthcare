import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";
import { loadState } from "../support/api";
import { E2E_DATABASE_URL, STAFF, TELE_DOCTOR_NAME } from "../support/env";
import { portalPage, staffPage, toast } from "../support/pages";

/**
 * CLAUDE.md §31 critical journey 2, through MyHealth and the staff app:
 * online booking → pre-consult questionnaire → waiting room → teleconsultation → prescription → laboratory order →
 * follow-up → instructions, prescription and follow-up visible to the patient. No video server runs: the consultation
 * falls back to the callback number, as it does in production when video is unavailable.
 */
test.describe.configure({ mode: "serial" });

test.describe("online booking to follow-up", () => {
  const errors: string[] = [];
  let patient: Page;
  let appointmentId = "";
  const instructions = "Take metformin with meals. Have the HbA1c test at the clinic laboratory this week.";

  test.beforeAll(async ({ browser }) => {
    patient = await portalPage(browser, loadState().onlinePatient.email, errors);
  });

  test.afterAll(() => {
    expect(errors, "page errors and server errors during the journey").toEqual([]);
  });

  test("the patient books an online consultation in MyHealth", async () => {
    await patient.goto("/appointments/book");
    await patient
      .getByRole("radiogroup", { name: "Kind of visit" })
      .getByRole("radio", { name: /Online consultation/ })
      .click();
    await patient.getByRole("radiogroup", { name: "Doctor" }).getByRole("radio", { name: TELE_DOCTOR_NAME }).click();
    // Tomorrow: online bookings need notice.
    await patient.getByRole("group", { name: "Day" }).getByRole("button").nth(1).click();
    await patient.locator('[role="group"]:not([aria-label="Day"]) button').first().click();
    await patient.locator("#reason").fill("Follow-up of high blood sugar");
    await patient.getByRole("button", { name: "Book this time" }).click();
    await patient.waitForURL(/\/appointments\?booked=/);
    appointmentId = new URL(patient.url()).searchParams.get("booked")!;
    await expect(patient.getByText(/Online consultation/).first()).toBeVisible();
  });

  test("time passes until the appointment", async () => {
    // The waiting room opens 30 minutes before the appointment and bookings need notice, so move this appointment to
    // a few minutes from now instead of waiting (test data only; nothing else in the journey is bypassed).
    const db = new Client({ connectionString: E2E_DATABASE_URL });
    await db.connect();
    const moved = await db.query(
      `UPDATE appointment SET starts_at = date_trunc('minute', now()) + interval '5 minutes', ends_at = date_trunc('minute', now()) + interval '25 minutes'
       WHERE id = $1`,
      [appointmentId],
    );
    await db.end();
    expect(moved.rowCount).toBe(1);
  });

  test("answers the pre-consult questions and enters the waiting room", async () => {
    await patient.goto(`/consultations/${appointmentId}`);
    await patient.getByLabel("Why are you consulting? *").fill("My fasting blood sugar was high at the pharmacy.");
    await patient.getByLabel("What symptoms do you have?").fill("Thirsty and tired.");
    await patient.getByLabel("For how many days?").fill("14");
    await patient.getByLabel(/Where will you be during the call/).fill("Quezon City");
    await patient.getByLabel(/A number we can call/).fill("0917 555 0142");
    await patient.getByRole("checkbox", { name: /I understand that an online consultation/ }).check();
    await patient.getByRole("button", { name: "Send my answers" }).click();
    await patient.getByRole("button", { name: "Enter the waiting room" }).click();
    await expect(patient.getByText("You are in the waiting room")).toBeVisible();
  });

  test("the doctor reviews the answers, consults, prescribes, orders a test and books the follow-up", async ({ browser }) => {
    const doctor = await staffPage(browser, STAFF.teleDoctor, errors);
    await doctor.goto("/telemedicine");
    await doctor.getByRole("link", { name: "Review and start" }).click();
    await expect(doctor.getByText("My fasting blood sugar was high at the pharmacy.")).toBeVisible();
    await doctor.getByRole("button", { name: "Start consultation" }).click();
    await doctor.waitForURL(/\/clinic\/encounters\/[0-9a-f-]{36}$/);
    const encounterUrl = doctor.url();
    // No video server: the panel says to call the patient on the callback number.
    await expect(doctor.getByText("0917 555 0142").first()).toBeVisible();

    await doctor.getByLabel("Subjective", { exact: true }).fill("Thirst and fatigue for two weeks; high fasting sugar at a pharmacy.");
    await doctor.getByLabel("Assessment", { exact: true }).fill("Hyperglycaemia, probable type 2 diabetes mellitus.");
    await doctor.getByLabel("Plan", { exact: true }).fill("Metformin; HbA1c; follow-up at the clinic in one month.");

    await doctor.getByRole("button", { name: /New prescription/ }).click();
    const rx = doctor.getByRole("dialog");
    await rx.locator("#rx-0-genericName").fill("Metformin");
    await rx.locator("#rx-0-strength").fill("500 mg");
    await rx.locator("#rx-0-dosageForm").fill("tablet");
    await rx.locator("#rx-0-doseAmount").fill("1");
    await rx.locator("#rx-0-doseUnit").fill("tablet");
    await rx.locator("#rx-0-frequency").selectOption({ label: "Twice a day" });
    await rx.locator("#rx-0-durationValue").fill("30");
    await rx.locator("#rx-0-durationUnit").selectOption("days");
    await rx.locator("#rx-0-quantity").fill("60");
    await rx.locator("#rx-0-quantityUnit").fill("tablets");
    await rx.locator("#rx-0-instructions").fill("Take with breakfast and dinner.");
    await rx.getByRole("button", { name: "Issue prescription" }).click();
    await toast(doctor, /Prescription .* issued/);

    await doctor.getByRole("button", { name: "Order tests" }).click();
    await doctor.getByLabel("HbA1c").check();
    await doctor.getByRole("button", { name: /^Order 1 test/ }).click();
    await toast(doctor, /sent to the laboratory/);

    // Follow-up at the clinic in a month, booked from the encounter (the booking returns to it).
    await doctor.getByRole("link", { name: "1 month" }).click();
    await doctor.waitForURL(/\/appointments\/new\?/);
    await doctor.locator("#visitType").selectOption({ label: "Consultation · 15 min" });
    await doctor.waitForURL(/visitTypeId=/);
    await doctor.getByRole("radiogroup", { name: "Open slots" }).getByRole("radio").first().click();
    await doctor.getByRole("button", { name: /^Book \d/ }).click();
    await toast(doctor, /Booked REYES, Ana/i);
    await doctor.waitForURL(encounterUrl);
    // The note typed before leaving to book was saved on the way out, not lost.
    await expect(doctor.getByLabel("Assessment", { exact: true })).toHaveValue(/Hyperglycaemia/);

    await doctor.getByRole("button", { name: /End consultation/ }).click();
    await doctor.locator("#patient-instructions").fill(instructions);
    await doctor.getByRole("button", { name: "End consultation", exact: true }).click();
    await toast(doctor, /Consultation ended/);
    await doctor.getByRole("button", { name: "Sign encounter" }).click();
    await toast(doctor, "Encounter signed");
    await doctor.context().close();
  });

  test("the patient sees the instructions, the prescription and the follow-up in MyHealth", async () => {
    await patient.goto(`/consultations/${appointmentId}`);
    await expect(patient.getByText("Your consultation has ended")).toBeVisible();
    await expect(patient.getByText(instructions)).toBeVisible();

    await patient.goto("/prescriptions");
    await expect(patient.getByText(/Metformin/).first()).toBeVisible();

    // The follow-up at the clinic, a month from now, is among the upcoming visits.
    await patient.goto("/appointments");
    const upcoming = patient.locator("section").filter({ has: patient.getByRole("heading", { name: "Upcoming" }) });
    await expect(upcoming.getByText(`Consultation with ${TELE_DOCTOR_NAME}`, { exact: true })).toBeVisible();
  });
});
