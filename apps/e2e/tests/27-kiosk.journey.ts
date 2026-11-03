import { expect, type Page, test } from "@playwright/test";
import { loadState, type StaffApi, staffApi } from "../support/api";
import { KIOSK_URL, STAFF, STAFF_PASSWORD } from "../support/env";
import { watchErrors } from "../support/pages";

/**
 * The patient self-service kiosk in a real browser (docs/domains/kiosk.md): the device signs in once, an existing patient
 * checks in as a walk-in and gets a queue ticket the front desk sees, a wrong identification is answered without saying what
 * was wrong, nothing reaches browser storage, a new patient's registration waits for reception under a reference, and every
 * visit ends back on the welcome screen with nothing of the last person left.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];

const patient = { id: "", number: "", given: "Kioskita", family: "Kioskuser" };

let page: Page;
/** Reception, signed in once for the whole file (sign-ins are rate limited). */
let desk: StaffApi;

/** E2E_KIOSK_SHOTS=<folder> saves a picture of the main screens, for a look at the design. */
async function shot(name: string) {
  if (process.env.E2E_KIOSK_SHOTS) await page.screenshot({ path: `${process.env.E2E_KIOSK_SHOTS}/${name}.png` });
}

async function startAtWelcome() {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await shot("1-welcome");
}

test.beforeAll(async ({ browser }) => {
  const admin = await staffApi(STAFF.admin, state.facilityId);
  const created = await admin.post<{ id: string; patientNumber: string }>("/patients", {
    familyName: patient.family,
    givenName: patient.given,
    sex: "female",
    birthDate: "1980-06-15",
    contacts: [{ system: "mobile", value: "0917 555 0127" }],
  });
  patient.id = created.id;
  patient.number = created.patientNumber;
  await admin.dispose();
  desk = await staffApi(STAFF.desk, state.facilityId);

  // A portrait touchscreen.
  const context = await browser.newContext({ baseURL: KIOSK_URL, viewport: { width: 1080, height: 1920 }, hasTouch: true });
  page = await context.newPage();
  watchErrors(page, "kiosk", errors);
});

test.afterAll(async () => {
  await desk.dispose();
  await page.context().close();
  expect(errors, "console or page errors on the kiosk").toEqual([]);
});

test("the kiosk answers with browser hardening headers and is never cached", async ({ request }) => {
  const response = await request.get(`${KIOSK_URL}/setup`, { maxRedirects: 0 });
  const headers = response.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["cache-control"]).toBe("no-store");
});

test("a mistyped address shows a plain page with one way back, not a technical error", async ({ page: visitor }) => {
  await visitor.goto(`${KIOSK_URL}/setup/nowhere-at-all`);
  await expect(visitor.getByRole("heading", { name: "We cannot find that page" })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Go to the start" })).toBeVisible();
});

test("a screen that is not signed in goes to set-up, and the kiosk account signs it in once", async () => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);

  await page.locator("#email").fill(STAFF.kiosk);
  await page.locator("#password").fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "Sign in this kiosk" }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByText("E2E Main Clinic").first()).toBeVisible();
});

test("an existing patient checks in as a walk-in and receives a ticket the front desk sees", async () => {
  await startAtWelcome();
  await page.getByRole("button", { name: "Touch here to check in" }).click();
  await shot("2-type");
  await page.getByRole("button", { name: "Yes, I am a patient here" }).click();
  await shot("3-existing");

  const fill = async (key: string, given: string) => {
    await page.locator("#key").fill(key);
    await page.locator("#birth-day").fill("15");
    await page.locator("#birth-month").selectOption({ label: "June" });
    await page.locator("#birth-year").fill("1980");
    await page.locator("#givenName").fill(given);
    await page.getByRole("button", { name: "Continue" }).click();
  };

  // A wrong first name gets the same plain answer for any wrong part.
  await fill(patient.number, "Someoneelse");
  await expect(page.getByRole("alert").filter({ hasText: "We could not find a matching record" })).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /birth|first name|number/i })
      .filter({ hasText: /wrong|incorrect/i }),
  ).toHaveCount(0);

  await fill(patient.number, patient.given);
  // Only initials come back, never the name or the number.
  await expect(page.getByRole("heading", { name: "What are you here for?" })).toBeVisible();
  await shot("4-services");
  await expect(page.getByText(/Hello,/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(patient.family);
  await expect(page.locator("body")).not.toContainText(patient.number);

  await page.getByRole("button", { name: state.kioskVisitType.name }).click();
  await expect(page.getByRole("heading", { name: "You are checked in" })).toBeVisible();
  await shot("5-ticket");
  const ticket = /A-\d{3}/.exec(await page.getByLabel("Your queue ticket").innerText())?.[0];
  expect(ticket).toBeTruthy();

  const board = JSON.stringify(await desk.get("/queue"));
  expect(board).toContain(ticket!);
  expect(board).toContain('"kiosk"');
});

test("nothing of the patient is kept in browser storage, and Done returns to a clean welcome", async () => {
  const kept = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  expect(kept).toEqual({ local: 0, session: 0, cookie: "" });

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("A-0");

  // The person's session cookie is gone with the session (the device's own cookies stay).
  await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === "kc_ss")).toBe(false);
});

test("a new patient registers, reviews the answers and leaves a reference for reception", async () => {
  await startAtWelcome();
  await page.getByRole("button", { name: "Touch here to check in" }).click();
  await page.getByRole("button", { name: "No, this is my first visit" }).click();

  // The required answers are checked before anything is sent.
  await page.getByRole("button", { name: "Check my answers" }).click();
  await expect(page.getByText("Please enter your first name")).toBeVisible();
  await shot("6-registration-errors");

  await page.locator("#familyName").fill("Newcomer");
  await page.locator("#givenName").fill("Nena");
  await page.locator("#birth-day").fill("2");
  await page.locator("#birth-month").selectOption({ label: "March" });
  await page.locator("#birth-year").fill("1991");
  await page.locator("#sex").selectOption({ label: "Female" });
  await page.locator("#mobile").fill("0918 555 0199");
  await page.locator("#cityMunicipality").fill("Quezon City");
  await page.locator("#emergencyName").fill("Nilo Newcomer");
  await page.locator("#emergencyNumber").fill("09175550123");
  await page.locator("#emergencyRelationship").selectOption({ label: "Brother or sister" });

  // The privacy notice must be accepted.
  await page.getByRole("button", { name: "Check my answers" }).click();
  await expect(page.getByText("Please tick the box to continue")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Check my answers" }).click();

  await expect(page.getByRole("heading", { name: "Is everything correct?" })).toBeVisible();
  await expect(page.getByText("Nena Newcomer")).toBeVisible();
  await shot("7-review");
  await expect(page.getByText("2 March 1991")).toBeVisible();
  await page.getByRole("button", { name: "Yes, send to reception" }).click();

  await expect(page.getByRole("heading", { name: "We received your details" })).toBeVisible();
  const reference = /KR-[A-HJ-NP-Z2-9]{6}/.exec(await page.getByLabel("Your registration reference").innerText())?.[0];
  expect(reference).toBeTruthy();
  // What was typed is gone from the screen.
  await expect(page.locator("body")).not.toContainText("Newcomer");

  // Done clears the screen for the next person.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();

  const pending = (await desk.get<{ items: Array<{ id: string; reference: string }> }>("/kiosk/admin/registrations")).items;
  const mine = pending.find((r) => r.reference === reference);
  expect(mine, "the registration is waiting for reception").toBeTruthy();
  await desk.post(`/kiosk/admin/registrations/${mine!.id}/reject`, { reason: "End-to-end test registration" });
});

test("Start over clears the screen and ends the session", async () => {
  await startAtWelcome();
  await page.getByRole("button", { name: "Touch here to check in" }).click();
  await page.getByRole("button", { name: "Yes, I am a patient here" }).click();
  await page.locator("#key").fill(patient.number);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await page.getByRole("button", { name: "Touch here to check in" }).click();
  await page.getByRole("button", { name: "Yes, I am a patient here" }).click();
  await expect(page.locator("#key")).toHaveValue("");
});
