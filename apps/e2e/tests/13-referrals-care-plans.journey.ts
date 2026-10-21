import { expect, type Page, test } from "@playwright/test";
import { staffApi } from "../support/api";
import { DOCTOR_NAME, STAFF, TELE_DOCTOR_NAME } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Referrals and care plans. A doctor refers a patient from a consultation to a colleague (who accepts and completes it),
 * to a second recipient (cancelled with a reason) and to an outside provider (reply recorded later); the organization
 * turns on the overdue flag. The doctor then writes a diabetes care plan with a goal and a recurring activity, books the
 * follow-up from the plan (the appointment is linked), adds a progress note and moves the plan through its statuses; the
 * recall list and Patient 360 show it.
 */
test.describe.configure({ mode: "serial" });
// A referral's letter is stored in object storage in the same request as the referral, so the API needs S3_* settings
// (and a reachable bucket, e.g. `pnpm dev:deps`) in its environment; without them creating a referral answers 500.
test.skip(
  !process.env.S3_ENDPOINT,
  "Referral letters need object storage: set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_FORCE_PATH_STYLE for the run",
);

const errors: string[] = [];

const patient = { id: "", family: "Referralcase", given: "Marites" };
const PLAN_TITLE = "Type 2 diabetes care plan";
const referrals = { internal: { id: "", number: "" }, cancelled: { id: "", number: "" }, external: { id: "", number: "" } };
let planId = "";
let encounterPath = "";

let doctor: Page;
let colleague: Page;
let admin: Page;

const sendReferral = async (page: Page): Promise<{ id: string; number: string }> => {
  // An earlier referral's toast may still be on screen: look for one that is not about a number already issued.
  const known = Object.values(referrals)
    .map((r) => r.number)
    .filter(Boolean);
  await page.getByRole("button", { name: "Send referral" }).click();
  let item = page.locator("[data-sonner-toast]").filter({ hasText: /Referral RF\d{8} sent/ });
  if (known.length) item = item.filter({ hasNotText: new RegExp(known.join("|")) });
  await expect(item.first()).toBeVisible();
  const number = /RF\d{8}/.exec(await item.first().innerText())![0];
  const link = page.getByRole("link", { name: number, exact: true });
  await expect(link).toBeVisible();
  const id = /\/clinic\/referrals\/([0-9a-f-]{36})/.exec((await link.getAttribute("href"))!)![1]!;
  return { id, number };
};

test.beforeAll(async ({ browser }) => {
  // Ids come from the API itself (not the shared seed file), so the journey stands on its own database.
  const bootstrap = await staffApi(STAFF.admin);
  const [facility] = await bootstrap.get<Array<{ id: string }>>("/facilities");
  await bootstrap.dispose();
  const api = await staffApi(STAFF.admin, facility!.id);
  const visitTypes = await api.get<Array<{ id: string; name: string }>>("/clinic/visit-types");
  const consultation = visitTypes.find((v) => v.name === "Consultation")!;
  patient.id = (
    await api.post<{ id: string }>("/patients", {
      familyName: patient.family,
      givenName: patient.given,
      sex: "female",
      birthDate: "1968-09-21",
      contacts: [{ system: "mobile", value: "0917 555 1313" }],
    })
  ).id;
  await api.post("/queue/walk-ins", { patientId: patient.id, visitTypeId: consultation.id, chiefComplaint: "Tingling feet and blurred vision" });
  await api.dispose();

  doctor = await staffPage(browser, STAFF.doctor, errors);
  colleague = await staffPage(browser, STAFF.teleDoctor, errors);
  admin = await staffPage(browser, STAFF.admin, errors);
});

test.afterAll(async () => {
  await doctor?.context().close();
  await colleague?.context().close();
  await admin?.context().close();
});

test("the doctor starts the consultation and records a diagnosis", async () => {
  await doctor.goto("/queue");
  await doctor.getByRole("button", { name: new RegExp(`A-\\d+.*${patient.family}`, "i") }).click();
  await doctor.getByRole("button", { name: "Start consultation" }).click();
  await doctor.waitForURL(/\/clinic\/encounters\/[0-9a-f-]{36}$/);
  encounterPath = new URL(doctor.url()).pathname;

  await doctor.getByLabel("Subjective", { exact: true }).fill("Tingling in both feet for three months, blurred vision.");
  await doctor.getByLabel("Assessment", { exact: true }).fill("Type 2 diabetes mellitus with neuropathic symptoms.");
  await doctor.getByLabel("Plan", { exact: true }).fill("Refer to a colleague for review; start a care plan.");
  await doctor.getByRole("button", { name: "Add diagnosis" }).click();
  await doctor.locator("#dx-display").fill("Type 2 diabetes mellitus without complications");
  await doctor.locator("#dx-code").fill("E11.9");
  await doctor.getByRole("button", { name: "Add diagnosis" }).click();
  await toast(doctor, /Diagnosis added/);
});

test("the doctor refers the patient to a colleague, to be cancelled later, and to an outside provider", async () => {
  const panel = doctor.getByRole("region", { name: "Referrals" });
  await expect(panel.getByText("No referral from this consultation.")).toBeVisible();

  // To a practitioner of the organization.
  await panel.getByRole("button", { name: "Refer" }).click();
  await panel.locator("#referral-to").selectOption({ label: TELE_DOCTOR_NAME });
  await panel.getByLabel("Specialty or service (optional)").fill("Internal medicine");
  await panel.getByLabel("Urgency").selectOption({ label: "Urgent" });
  await panel.getByLabel("Reason for referral").fill("Review of neuropathic symptoms and glycaemic control");
  await panel.getByLabel("Clinical summary (optional)").fill("Three months of tingling in both feet; fasting sugar pending.");
  // The consultation's diagnosis goes on the letter (ticked here: a diagnosis added after the page opened is not pre-ticked).
  await panel.getByLabel(/E11\.9/).check();
  referrals.internal = await sendReferral(doctor);
  expect(referrals.internal.number).toMatch(/^RF\d{8}$/);
  await expect(panel.getByText("Awaiting answer").first()).toBeVisible();

  // The letter is stored once and opens as a PDF.
  const letter = panel.getByRole("link", { name: "Letter" }).first();
  const response = await doctor.request.get(new URL((await letter.getAttribute("href"))!, doctor.url()).toString());
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("pdf");

  // A second one, which will be cancelled.
  await panel.getByRole("button", { name: "Refer" }).click();
  await panel.locator("#referral-to").selectOption({ label: TELE_DOCTOR_NAME });
  await panel.getByLabel("Reason for referral").fill("Duplicate request sent by mistake");
  referrals.cancelled = await sendReferral(doctor);
  expect(referrals.cancelled.number).not.toBe(referrals.internal.number);

  // To an outside provider, named as written.
  await panel.getByRole("button", { name: "Refer" }).click();
  await panel.getByRole("radio", { name: "An outside provider" }).click();
  await panel.locator("#referral-provider").fill("Dr. Lourdes Villanueva");
  await panel.getByLabel("Facility (optional)").fill("Eye Center Manila");
  await panel.getByLabel("Specialty or service (optional)").fill("Ophthalmology");
  await panel.getByLabel("Reason for referral").fill("Dilated eye examination for blurred vision");
  referrals.external = await sendReferral(doctor);
  await expect(panel.getByText("Dr. Lourdes Villanueva, Eye Center Manila · Ophthalmology")).toBeVisible();
});

test("the second referral is cancelled with a reason", async () => {
  await doctor.goto(`/clinic/referrals/${referrals.cancelled.id}`);
  const cancel = doctor.getByRole("button", { name: "Cancel referral" });
  await expect(cancel).toBeDisabled();
  await doctor.getByLabel("Reason", { exact: true }).fill("Sent twice by mistake");
  await cancel.click();
  await toast(doctor, "Referral cancelled");
  await expect(doctor.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(doctor.getByText(/Sent twice by mistake/)).toBeVisible();
});

test("the colleague sees the referral, accepts it and later completes it", async () => {
  await colleague.goto("/clinic/referrals");
  const row = colleague.getByRole("row").filter({ hasText: referrals.internal.number });
  await expect(row).toContainText(DOCTOR_NAME);
  await expect(row.getByText("Urgent")).toBeVisible();
  await colleague.getByRole("link", { name: referrals.internal.number }).click();
  await colleague.waitForURL(/\/clinic\/referrals\/[0-9a-f-]{36}$/);
  await expect(colleague.getByText("Review of neuropathic symptoms and glycaemic control")).toBeVisible();
  await expect(colleague.getByText("E11.9", { exact: false }).first()).toBeVisible();

  await colleague.getByLabel(/Note to the referrer/).fill("Will see her this week.");
  await colleague.getByRole("button", { name: "Accept", exact: true }).click();
  await toast(colleague, "Referral accepted");
  await expect(colleague.getByText("Accepted", { exact: true }).first()).toBeVisible();

  await colleague.getByLabel("What came of it").fill("Seen; metformin dose adjusted, foot care taught, review in three months.");
  await colleague.getByRole("button", { name: "Complete referral" }).click();
  await toast(colleague, "Referral completed");
  await expect(colleague.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(colleague.getByText(/metformin dose adjusted/)).toBeVisible();
});

test("the outside provider's reply is recorded later", async () => {
  await doctor.goto(`/clinic/referrals/${referrals.external.id}`);
  await expect(doctor.getByText("Awaiting answer").first()).toBeVisible();
  await doctor.getByLabel("The provider's reply, as received").fill("Mild background retinopathy; review in 6 months.");
  await doctor.getByRole("button", { name: "Record reply" }).click();
  await toast(doctor, "Referral completed");
  await expect(doctor.getByText(/Mild background retinopathy/)).toBeVisible();

  // The doctor's list of referrals made by them shows all three with their status.
  await doctor.goto("/clinic/referrals?view=from_me");
  await expect(doctor.getByRole("row").filter({ hasText: referrals.internal.number })).toContainText("Completed");
  await expect(doctor.getByRole("row").filter({ hasText: referrals.cancelled.number })).toContainText("Cancelled");
  await expect(doctor.getByRole("row").filter({ hasText: referrals.external.number })).toContainText("Completed");
});

test("an administrator turns on the overdue flag", async () => {
  await admin.goto("/clinic/referrals/settings");
  await admin.getByLabel("Flag referrals still awaiting an answer or reply").check();
  await admin.getByLabel("After how many days").fill("7");
  await admin.getByRole("button", { name: "Save" }).click();
  await toast(admin, /Referrals are overdue 7 days after they were sent/);
  await admin.goto("/clinic/referrals?view=overdue");
  await expect(admin.getByText(/marked Overdue/)).toBeVisible();
  await expect(admin.getByText("No referrals here.")).toBeVisible();
});

test("the doctor writes a care plan with a goal and activities, one of them recurring", async () => {
  await doctor.goto(encounterPath);

  await doctor.getByRole("button", { name: "New care plan" }).click();
  const dialog = doctor.getByRole("dialog");
  await dialog.getByLabel("Title").fill(PLAN_TITLE);
  await dialog.getByLabel("Description").fill("Long-term control of blood sugar with regular monitoring.");
  await expect(dialog.getByText("Type 2 diabetes mellitus without complications")).toBeVisible();

  await dialog.getByLabel("Goal 1", { exact: true }).fill("Glycaemic control");
  await dialog.getByLabel("Goal 1 measure").fill("HbA1c");
  await dialog.getByLabel("Goal 1 target", { exact: true }).fill("< 7%");

  await dialog.getByLabel("Activity 1", { exact: true }).fill("Review sugar diary with the doctor");
  await dialog.getByRole("button", { name: "+14 d" }).first().click();
  await dialog.getByRole("button", { name: "Add activity" }).click();
  await dialog.getByLabel("Activity 2", { exact: true }).fill("Repeat HbA1c");
  await dialog.getByLabel("Activity 2 goal").selectOption({ label: "Glycaemic control" });
  await dialog.getByRole("button", { name: "+14 d" }).nth(1).click();
  await dialog.getByLabel("Repeat every").nth(1).fill("90");

  await dialog.getByRole("button", { name: "Create care plan" }).click();
  await toast(doctor, `Care plan created: ${PLAN_TITLE}`);

  const panel = doctor.getByRole("region", { name: "Care plans" });
  await expect(panel.getByText(PLAN_TITLE)).toBeVisible();
  await expect(panel.getByText("Goals: Glycaemic control < 7%")).toBeVisible();
  await expect(panel.getByText("every 90 d")).toBeVisible();
  planId = /\/clinic\/care-plans\/([0-9a-f-]{36})/.exec((await panel.getByRole("link", { name: "Open plan" }).getAttribute("href"))!)![1]!;
});

test("the recall list shows the plan's activities that fall due", async () => {
  await doctor.goto("/clinic/care-plans?within=30");
  const repeat = doctor.getByRole("row").filter({ hasText: "Repeat HbA1c" });
  await expect(repeat).toContainText(patient.family.toUpperCase());
  await expect(repeat).toContainText("every 90 days");
  await expect(repeat.getByRole("link", { name: PLAN_TITLE })).toBeVisible();
  await expect(doctor.getByRole("row").filter({ hasText: "Review sugar diary with the doctor" })).toBeVisible();
  // Nothing is that close yet.
  await doctor.goto("/clinic/care-plans?within=7");
  await expect(doctor.getByText("Nothing is due in this period.")).toBeVisible();
});

test("the follow-up is booked from the plan and the appointment is linked", async () => {
  // From the consultation's care-plan panel, which knows the practitioner (a plan made in the UI records no author, so the
  // plan page's Book link opens the booking form without a doctor chosen).
  await doctor.goto(encounterPath);
  const activity = doctor.getByRole("region", { name: "Care plans" }).locator("li").filter({ hasText: "Review sugar diary with the doctor" }).first();
  await activity.getByRole("link", { name: "Book" }).click();
  await doctor.waitForURL(/\/appointments\/new\?/);
  await expect(doctor.locator("#practitioner")).toHaveValue(/.+/);
  await doctor.locator("#visitType").selectOption({ label: "Consultation · 15 min" });
  await doctor.waitForURL(/visitTypeId=/);
  await doctor.getByRole("radiogroup", { name: "Open slots" }).getByRole("radio").first().click();
  await doctor.getByRole("button", { name: /^Book \d/ }).click();
  await toast(doctor, new RegExp(`Booked ${patient.family}`, "i"));
  await doctor.waitForURL(new RegExp(`${encounterPath}$`));

  await doctor.goto(`/clinic/care-plans/${planId}`);
  const scheduled = doctor.locator("li").filter({ hasText: "Review sugar diary with the doctor" }).first();
  await expect(scheduled.getByText("Scheduled")).toBeVisible();
  await expect(scheduled.getByRole("link", { name: "Book" })).toHaveCount(0);
});

test("a progress note, a goal and the plan's status are updated", async () => {
  await doctor.getByLabel("New note").fill("Patient started the sugar diary; fasting values 7 to 9 mmol/L.");
  await doctor.getByRole("button", { name: "Add note" }).click();
  await toast(doctor, "Progress note added");
  await expect(doctor.getByText(/fasting values 7 to 9/)).toBeVisible();

  await doctor.getByLabel("Status of goal Glycaemic control").selectOption({ label: "Achieved" });
  await toast(doctor, "Goal: Achieved");

  // The recurring activity is done: the next one is due in 90 days.
  await doctor.locator("li").filter({ hasText: "Repeat HbA1c" }).first().getByRole("button", { name: "Done" }).click();
  await toast(doctor, "Done: Repeat HbA1c");

  // Pausing needs a reason; the plan can be resumed.
  await doctor.getByRole("button", { name: "Put on hold…" }).click();
  await expect(doctor.getByRole("button", { name: "Put on hold", exact: true })).toBeDisabled();
  await doctor.locator("#plan-reason").fill("Patient travelling for two weeks");
  await doctor.getByRole("button", { name: "Put on hold", exact: true }).click();
  await toast(doctor, "Care plan on hold");
  await expect(doctor.getByText("Status reason: Patient travelling for two weeks")).toBeVisible();
  await doctor.getByRole("button", { name: "Resume" }).click();
  await toast(doctor, "Care plan active");
});

test("the plan is on Patient 360, then completed and gone from the recall list", async () => {
  await doctor.goto(`/patients/${patient.id}/360`);
  await expect(doctor.getByText(PLAN_TITLE).first()).toBeVisible();

  await doctor.goto(`/clinic/care-plans/${planId}`);
  await doctor.getByRole("button", { name: "Mark completed" }).click();
  await toast(doctor, "Care plan completed");
  await doctor.goto("/clinic/care-plans?within=90");
  await expect(doctor.getByRole("row").filter({ hasText: PLAN_TITLE })).toHaveCount(0);
});

test("the consultation is signed and nothing broke along the way", async () => {
  await doctor.goto(encounterPath);
  // The note was never saved as a draft while the doctor moved between screens: write it again and sign.
  await doctor.getByLabel("Subjective", { exact: true }).fill("Tingling in both feet for three months, blurred vision.");
  await doctor.getByLabel("Assessment", { exact: true }).fill("Type 2 diabetes mellitus with neuropathic symptoms.");
  await doctor.getByLabel("Plan", { exact: true }).fill("Referrals sent; care plan started.");
  await doctor.getByRole("button", { name: "Sign encounter" }).click();
  await toast(doctor, "Encounter signed");
  // The referral list in the signed consultation keeps all three with their numbers.
  const panel = doctor.getByRole("region", { name: "Referrals" });
  for (const r of Object.values(referrals)) await expect(panel.getByRole("link", { name: r.number, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
