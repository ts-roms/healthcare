import { expect, type Locator, type Page, request, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { API_URL, ORGANIZATION_CODE, PATIENT_PASSWORD, STAFF, STAFF_PASSWORD } from "../support/env";
import { portalPage, staffPage, toast } from "../support/pages";

/**
 * Records requests: a patient asks in MyHealth for copies of their records and for other rights under the Data Privacy
 * Act; the records officer prepares a copy of the record (PDF), shares it, declines one with a reason and answers a
 * correction by saying what was done (nothing is changed automatically); request limits, withdrawing, and who may see
 * the records screens.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];

const person = { id: "", number: "", family: "Recordsreq", given: "Rina", birthDate: "1990-02-14", email: "rina.recordsreq@e2e.ph" };
const TAG = {
  copy: "COPYTAG employer paperwork",
  decline: "DECLINETAG second copy",
  fix: "FIXTAG my given name is spelled wrong",
  fix2: "FIXTAG2 my birth date is wrong",
};
/**
 * Copies are stored in object storage, which the E2E stack does not start: run with S3_ENDPOINT, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY, S3_BUCKET and S3_FORCE_PATH_STYLE=true in the environment (e.g. the development MinIO).
 * Without S3_ENDPOINT the copy and its sharing are skipped.
 */
const storage = Boolean(process.env.S3_ENDPOINT);
const IDENTITY = "Valid ID shown at the counter";

let patient: Page;
let records: Page;
let admin: Page;
const numbers: Record<"copy" | "decline" | "fix" | "fix2", string> = { copy: "", decline: "", fix: "", fix2: "" };

/** The patient's request card containing the text. */
const card = (page: Page, text: string): Locator => page.locator("article").filter({ hasText: text });

async function sendRequest(
  page: Page,
  options: { kind?: string; scope: string[]; details?: string; purpose?: string; from?: string; to?: string },
): Promise<string> {
  await page.getByRole("button", { name: "Ask the records office" }).click();
  if (options.kind) await page.getByLabel("What do you want to ask?").selectOption({ label: options.kind });
  for (const s of options.scope) await page.getByRole("checkbox", { name: s }).check();
  if (options.from) await page.getByLabel("From (optional)").fill(options.from);
  if (options.to) await page.getByLabel("To (optional)").fill(options.to);
  if (options.details) await page.locator("form textarea").fill(options.details);
  if (options.purpose) await page.getByLabel("What you need them for (optional)").fill(options.purpose);
  await page.getByRole("button", { name: "Send request" }).click();
  // The confirmation line disappears when this was the third open request, so read the number off the new card.
  const sent = card(page, options.details!);
  await expect(sent).toContainText(/RR\d+/);
  return /RR\d+/.exec(await sent.innerText())![0];
}

/** Clicks a button that opens a signed file link in a new tab and returns what the link answers. */
async function openedFile(page: Page, click: () => Promise<void>): Promise<{ status: number; type: string; size: number }> {
  const origin = new URL(page.url()).origin;
  // The new tab goes straight to the link (a PDF may be shown or downloaded, so read the link itself).
  const linked = page
    .context()
    .waitForEvent("request", { predicate: (r) => r.resourceType() === "document" && !r.url().startsWith(origin) && /^https?:/.test(r.url()) });
  await click();
  const url = (await linked).url();
  const client = await request.newContext();
  const response = await client.get(url);
  const body = await response.body();
  await client.dispose();
  for (const tab of page.context().pages()) if (tab !== page) await tab.close().catch(() => undefined);
  return { status: response.status(), type: response.headers()["content-type"] ?? "", size: body.length };
}

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const created = await api.post<{ id: string; patientNumber: string }>("/patients", {
    familyName: person.family,
    givenName: person.given,
    sex: "female",
    birthDate: person.birthDate,
    contacts: [{ system: "mobile", value: "0917 555 0177" }],
  });
  person.id = created.id;
  person.number = created.patientNumber;
  await api.post(`/patients/${person.id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" });
  const { activationCode } = await api.post<{ activationCode: string }>(`/patients/${person.id}/portal-account/invitations`);
  const portal = await request.newContext();
  const activated = await portal.post(`${API_URL}/portal/auth/activate`, {
    data: {
      organizationCode: ORGANIZATION_CODE,
      patientNumber: person.number,
      birthDate: person.birthDate,
      activationCode,
      email: person.email,
      password: PATIENT_PASSWORD,
    },
  });
  if (!activated.ok()) throw new Error(`Portal activation failed: ${activated.status()} ${await activated.text()}`);
  await portal.dispose();
  await api.dispose();

  // A small signed consultation for the copy of the record to contain (the doctor's own API session).
  const client = await request.newContext();
  const login = await client.post(`${API_URL}/auth/login`, { data: { email: STAFF.doctor, password: STAFF_PASSWORD } });
  const headers = { authorization: `Bearer ${((await login.json()) as { accessToken: string }).accessToken}`, "x-facility-id": state.facilityId };
  const call = async <T>(method: "POST" | "PUT", path: string, data: unknown): Promise<T> => {
    const response = await client.fetch(`${API_URL}${path}`, { method, headers, data });
    if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()}: ${await response.text()}`);
    return (await response.json()) as T;
  };
  const encounter = await call<{ id: string }>("POST", "/encounters", { patientId: person.id, chiefComplaint: "Dry cough for three days" });
  await call("PUT", `/encounters/${encounter.id}/note`, {
    basedOnRevision: 0,
    subjective: "Dry cough for three days, no fever.",
    assessment: "Mild upper respiratory tract infection.",
    plan: "Fluids and rest; return if breathing worsens.",
  });
  await call("POST", `/encounters/${encounter.id}/diagnoses`, { display: "Acute upper respiratory infection", rank: "primary" });
  const current = await (await client.fetch(`${API_URL}/encounters/${encounter.id}`, { headers })).json();
  await call("POST", `/encounters/${encounter.id}/sign`, { version: (current as { version: number }).version });
  await client.dispose();

  records = await staffPage(browser, STAFF.records, errors);
  admin = await staffPage(browser, STAFF.admin, errors);
  patient = await portalPage(browser, person.email, errors);
});

test.afterAll(() => {
  expect(errors, "page errors and server errors during the journey").toEqual([]);
});

test("the administrator sets the clinic's records-request procedure", async () => {
  await admin.goto("/records/requests/settings");
  await admin.locator("#response-days").fill("5");
  await admin.getByRole("checkbox", { name: /Record how the requester/ }).check();
  await admin.locator("#patient-notice").fill("Bring a valid ID. The records office answers within five days.");
  await admin.getByRole("button", { name: "Save procedure" }).click();
  await toast(admin, "Procedure saved");
});

test("the patient sees the clinic's notice and asks for copies of their records", async () => {
  await patient.goto("/documents");
  await expect(patient.getByRole("heading", { name: "Copies of your records" })).toBeVisible();
  await expect(patient.getByText("No requests yet")).toBeVisible();
  await patient.getByRole("button", { name: "Ask the records office" }).click();
  await expect(patient.getByText("Bring a valid ID. The records office answers within five days.")).toBeVisible();
  await expect(patient.getByText("The clinic aims to answer within 5 days.")).toBeVisible();
  // Nothing can be sent without choosing what it is about.
  await expect(patient.getByRole("button", { name: "Send request" })).toBeDisabled();
  await patient.getByRole("button", { name: "Cancel" }).click();

  numbers.copy = await sendRequest(patient, { scope: ["Consultation records", "Prescriptions"], details: TAG.copy, purpose: "Employer paperwork" });
  const mine = card(patient, TAG.copy);
  await expect(mine).toContainText(numbers.copy);
  await expect(mine).toContainText("Consultation records, Prescriptions");
  await expect(mine).toContainText("Sent — waiting for the records office");
  await expect(mine).toContainText("The clinic aims to answer by");
});

test("a correction needs details, and at most three requests can be open", async () => {
  // A request of another kind must say what is wrong.
  await patient.getByRole("button", { name: "Ask the records office" }).click();
  await patient.getByLabel("What do you want to ask?").selectOption({ label: "Correct something in my records" });
  await patient.getByRole("checkbox", { name: "Consultation records" }).check();
  await patient.locator("form textarea").fill("too short");
  await expect(patient.getByRole("button", { name: "Send request" })).toBeDisabled();
  await patient.getByRole("button", { name: "Cancel" }).click();

  numbers.decline = await sendRequest(patient, { scope: ["Laboratory results"], details: TAG.decline });
  numbers.fix = await sendRequest(patient, { kind: "Correct something in my records", scope: ["Consultation records"], details: TAG.fix });
  await expect(patient.getByText("You have 3 requests waiting.")).toBeVisible();
  await expect(patient.getByRole("button", { name: "Ask the records office" })).toHaveCount(0);
});

test("the patient withdraws an open request and can ask again", async () => {
  // Withdrawn here, so the correction answered later is a fresh request.
  const open = card(patient, TAG.fix);
  await open.getByRole("button", { name: "Withdraw this request" }).click();
  await expect(open).toContainText("You withdrew this request");
  await expect(open.getByRole("button", { name: "Withdraw this request" })).toHaveCount(0);
  numbers.fix2 = await sendRequest(patient, {
    kind: "Correct something in my records",
    scope: ["Consultation records"],
    details: TAG.fix2,
    from: "2026-01-01",
  });
  await expect(card(patient, TAG.fix2)).toContainText("Correct something in my records");
  await expect(patient.getByText("You have 3 requests waiting.")).toBeVisible();
});

test("the records officer sees the requests with their kind", async () => {
  await records.goto("/records/requests");
  await expect(records.getByRole("heading", { name: "Records requests" })).toBeVisible();
  const row = (number: string) => records.getByRole("row").filter({ hasText: number });
  await expect(row(numbers.copy)).toContainText(/recordsreq/i);
  await expect(row(numbers.copy)).toContainText("Copies");
  await expect(row(numbers.copy)).toContainText("Respond by");
  await expect(row(numbers.copy)).toContainText("New");
  await expect(row(numbers.fix2)).toContainText("Correction");
  // The withdrawn one is not open work, but stays in the full list.
  await expect(row(numbers.fix)).toHaveCount(0);
  await records.getByRole("link", { name: "All", exact: true }).click();
  await expect(row(numbers.fix)).toContainText("Withdrawn by the patient");
});

test("the copy of the record is prepared as a PDF and shared once the identity check is written", async () => {
  test.skip(!storage, "no object storage in this run (set S3_ENDPOINT)");
  await records.goto("/records/requests");
  await records.getByRole("row").filter({ hasText: numbers.copy }).getByRole("link", { name: "Review" }).click();
  await records.waitForURL(/\/records\/requests\/[0-9a-f-]{36}$/);
  await expect(records.getByRole("heading", { name: `Records request ${numbers.copy}` })).toBeVisible();
  await expect(records.getByText(TAG.copy)).toBeVisible();
  await records.getByRole("button", { name: "Take into review" }).click();
  await toast(records, "Taken into review");

  // A copy of the record: chosen sections over a period, compiled into one PDF stored in the record.
  await records.getByRole("checkbox", { name: /^Consultations/ }).check();
  await records.getByRole("checkbox", { name: /^Allergies/ }).check();
  await records.getByRole("checkbox", { name: /^Immunizations/ }).uncheck();
  await records.getByRole("button", { name: "Prepare copy" }).click();
  await toast(records, /Copy prepared/);
  const prepared = records.getByRole("listitem").filter({ hasText: "Allergies, Consultations" });
  await expect(prepared).toHaveCount(1);

  // The staff member can open the PDF behind a short-lived link.
  const opened = await openedFile(records, () => prepared.getByRole("button", { name: "Open" }).click());
  expect(opened.status).toBe(200);
  expect(opened.type).toContain("application/pdf");
  expect(opened.size).toBeGreaterThan(500);

  // Share it: the copy now lists among the documents of the record. The procedure requires the identity check.
  const share = records.getByRole("button", { name: /^Share/ });
  await records
    .getByRole("group", { name: /Documents to share from the patient's record/ })
    .getByRole("checkbox")
    .first()
    .check();
  await records.locator("#share-note").fill("Your consultation record is attached.");
  await expect(share).toBeDisabled();
  await records.locator("#identity-check").fill(IDENTITY);
  await expect(share).toBeEnabled();
  await share.click();
  await toast(records, /Shared — the patient can download/);
  await expect(records.getByText(`Identity confirmed: ${IDENTITY}`)).toBeVisible();
});

test("the patient reads the answer and opens the shared copy behind a short-lived link", async () => {
  test.skip(!storage, "no object storage in this run (set S3_ENDPOINT)");
  await patient.goto("/documents");
  const mine = card(patient, TAG.copy);
  await expect(mine).toContainText("Answered — your copies are below");
  await expect(mine).toContainText("From the records office: Your consultation record is attached.");
  await expect(mine.getByRole("button", { name: "Withdraw this request" })).toHaveCount(0);
  const opened = await openedFile(patient, () => mine.getByRole("button", { name: "Download" }).click());
  expect(opened.status).toBe(200);
  expect(opened.type).toContain("application/pdf");
  expect(opened.size).toBeGreaterThan(500);
});

test("another request is declined with a reason the patient reads", async () => {
  await records.goto("/records/requests");
  await records.getByRole("row").filter({ hasText: numbers.decline }).getByRole("link", { name: "Review" }).click();
  await records.waitForURL(/\/records\/requests\/[0-9a-f-]{36}$/);
  await records.getByRole("button", { name: "Decline…" }).click();
  const decline = records.getByRole("button", { name: "Decline request" });
  await expect(decline).toBeDisabled();
  await records.getByLabel("Reason the patient will read").fill("We could not confirm your identity; please bring a valid ID.");
  await decline.click();
  await toast(records, /Declined — the patient reads your reason/);
  await expect(records.getByText("Reason given: We could not confirm your identity; please bring a valid ID.")).toBeVisible();

  await patient.goto("/documents");
  const mine = card(patient, TAG.decline);
  await expect(mine).toContainText("Not granted — see the reason");
  await expect(mine).toContainText("Reason: We could not confirm your identity; please bring a valid ID.");
  await expect(mine.getByRole("button", { name: "Withdraw this request" })).toHaveCount(0);
});

test("a correction is answered with a note, and the platform changes nothing by itself", async () => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const before = await api.get<{ familyName: string; givenName: string; birthDate: string }>(`/patients/${person.id}`);

  await records.goto("/records/requests");
  await records.getByRole("row").filter({ hasText: numbers.fix2 }).getByRole("link", { name: "Review" }).click();
  await records.waitForURL(/\/records\/requests\/[0-9a-f-]{36}$/);
  await expect(records.getByText("Correction").first()).toBeVisible();
  await expect(records.getByText(TAG.fix2)).toBeVisible();
  // A correction is answered in words (no copy of the record is offered).
  await expect(records.getByText("Copy of the record", { exact: true })).toHaveCount(0);
  const answer = records.getByRole("button", { name: "Answer request" });
  await expect(answer).toBeDisabled();
  await records.locator("#share-note").fill("We checked your ID and corrected the birth date by hand in the registration record.");
  await records.locator("#identity-check").fill(IDENTITY);
  await answer.click();
  await toast(records, /Answered — the patient reads your note/);
  await expect(records.getByText("Note to the patient: We checked your ID")).toBeVisible();

  // Nothing was changed on the patient's record by answering.
  const after = await api.get<{ familyName: string; givenName: string; birthDate: string }>(`/patients/${person.id}`);
  expect(after.familyName).toBe(before.familyName);
  expect(after.givenName).toBe(before.givenName);
  expect(after.birthDate).toBe(before.birthDate);
  await api.dispose();

  await patient.goto("/documents");
  const mine = card(patient, TAG.fix2);
  await expect(mine).toContainText("Answered — see what the clinic did below");
  await expect(mine).toContainText("What the clinic did: We checked your ID and corrected the birth date by hand");
  // Nothing is open any more: the patient can ask again.
  await expect(patient.getByRole("button", { name: "Ask the records office" })).toBeVisible();
});

test("the retention and integrity screens open for the records officer", async () => {
  await records.goto("/records/retention");
  await expect(records.getByRole("heading", { name: "Document retention" })).toBeVisible();
  await expect(records.getByText(/nothing is ever deleted automatically/)).toBeVisible();
  await records.goto("/records/integrity");
  await expect(records.getByRole("heading", { name: "Document integrity" })).toBeVisible();
});

test("a role without the permission is turned away from the records screens", async ({ browser }) => {
  const cashier = await staffPage(browser, STAFF.cashier, errors);
  for (const path of ["/records/requests", "/records/retention", "/records/integrity", "/records/requests/settings"]) {
    await cashier.goto(path);
    await expect.poll(() => new URL(cashier.url()).pathname).not.toMatch(/^\/records/);
  }
  await expect(cashier.getByRole("link", { name: /Records requests/i })).toHaveCount(0);
  await cashier.context().close();

  const api = await staffApi(STAFF.cashier, state.facilityId);
  await expect(api.get("/records-requests")).rejects.toThrow(/403/);
  await api.dispose();
});
