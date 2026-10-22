import { expect, type Page, request, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { API_URL, STAFF, STAFF_PASSWORD } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Electronic signatures, phase 3 (migration 0122): the administrator turns on printing practitioners' signatures; the doctor
 * draws their own under My account; a certificate issued afterwards carries it. A nurse, who is not a practitioner, has none
 * to draw.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];
const patient = { id: "", family: "Signaturecert", given: "Celia" };
let admin: Page;
let doctor: Page;
let nurse: Page;

/** A full-page screenshot kept with the test's output (and attached to the report). */
const shot = async (page: Page, name: string) => {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
};

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  patient.id = (
    await api.post<{ id: string }>("/patients", {
      familyName: patient.family,
      givenName: patient.given,
      sex: "female",
      birthDate: "1979-08-14",
      contacts: [{ system: "mobile", value: "0917 555 4141" }],
    })
  ).id;
  await api.dispose();
  admin = await staffPage(browser, STAFF.admin, errors);
  doctor = await staffPage(browser, STAFF.doctor, errors);
  nurse = await staffPage(browser, STAFF.nurse, errors);
});

test.afterAll(async () => {
  await admin?.context().close();
  await doctor?.context().close();
  await nurse?.context().close();
  expect(errors, "page errors and server errors during the journey").toEqual([]);
});

test("the administrator turns on printing practitioners' signatures", async () => {
  await admin.goto("/clinic/signatures");
  await expect(admin.getByRole("heading", { name: "Signatures on documents" })).toBeVisible();
  const box = admin.getByLabel(/Print the practitioner.s signature/);
  await expect(box).not.toBeChecked();
  await shot(admin, "1-setting-off");
  await box.check();
  await admin.getByRole("button", { name: "Save" }).click();
  await toast(admin, "Setting saved");
  await shot(admin, "2-setting-on");
});

test("the doctor draws their own signature under My account", async () => {
  await doctor.goto("/account");
  const card = doctor.locator("div").filter({ has: doctor.getByRole("heading", { name: "My signature" }) });
  await expect(doctor.getByText("You have not drawn a signature.")).toBeVisible();
  await expect(doctor.getByText("Your clinic prints it on the medical certificates and referral letters you issue.")).toBeVisible();
  const save = doctor.getByRole("button", { name: "Save signature" });
  await expect(save).toBeDisabled();
  const pad = doctor.getByRole("img", { name: /Signature pad/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await doctor.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.6);
  await doctor.mouse.down();
  for (const [x, y] of [
    [0.2, 0.2],
    [0.3, 0.75],
    [0.42, 0.25],
    [0.55, 0.7],
    [0.7, 0.3],
    [0.88, 0.55],
  ] as const) {
    await doctor.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
  }
  await doctor.mouse.up();
  await expect(save).toBeEnabled();
  await shot(doctor, "3-drawn");
  await save.click();
  await toast(doctor, "Signature saved");
  await expect(doctor.getByRole("img", { name: "Your saved signature" })).toBeVisible();
  await expect(doctor.getByRole("button", { name: "Remove it" })).toBeVisible();
  await shot(doctor, "4-saved");
  expect(await card.count()).toBeGreaterThan(0);
});

test("a nurse has no signature to draw, and a certificate issued now carries the doctor's", async () => {
  await nurse.goto("/account");
  await expect(nurse.getByRole("heading", { name: "My account" })).toBeVisible();
  await expect(nurse.getByRole("heading", { name: "My signature" })).toHaveCount(0);

  // A signed consultation and its certificate, through the doctor's own API session.
  const client = await request.newContext();
  // The API allows about 10 credential attempts a minute per client; late in a long run this one can be refused: wait out the window.
  let accessToken = "";
  for (let attempt = 1; !accessToken; attempt += 1) {
    const login = await client.post(`${API_URL}/auth/login`, { data: { email: STAFF.doctor, password: STAFF_PASSWORD } });
    if (login.ok()) accessToken = ((await login.json()) as { accessToken: string }).accessToken;
    else if (attempt >= 3 || login.status() !== 429) throw new Error(`Sign-in as the doctor was refused: ${login.status()}`);
    else await new Promise((resolve) => setTimeout(resolve, 61_000));
  }
  const headers = { authorization: `Bearer ${accessToken}`, "x-facility-id": state.facilityId };
  const call = async <T>(method: "GET" | "POST" | "PUT", path: string, data?: unknown): Promise<T> => {
    const response = await client.fetch(`${API_URL}${path}`, { method, headers, data });
    if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()}: ${await response.text()}`);
    return (await response.json()) as T;
  };
  const encounter = await call<{ id: string }>("POST", "/encounters", { patientId: patient.id, chiefComplaint: "Fever for two days" });
  await call("PUT", `/encounters/${encounter.id}/note`, { basedOnRevision: 0, assessment: "Viral fever", plan: "Rest and fluids" });
  const current = await call<{ version: number }>("GET", `/encounters/${encounter.id}`);
  await call("POST", `/encounters/${encounter.id}/sign`, { version: current.version });
  const certificate = await call<{ id: string; certificateNumber: string; practitionerSignatureId: string | null }>(
    "POST",
    `/encounters/${encounter.id}/certificates`,
    {
      purpose: "Absence from work",
      findings: "Viral fever, seen today",
    },
  );
  const pdf = await client.fetch(`${API_URL}/medical-certificates/${certificate.id}/certificate.pdf`, { headers });
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const mine = await call<{ signature: { id: string } | null }>("GET", "/me/practitioner-signature");
  expect(mine.signature).not.toBeNull();
  // The certificate records the signature in force when it was issued.
  expect(certificate.practitionerSignatureId).toBe(mine.signature!.id);
  await client.dispose();
});
