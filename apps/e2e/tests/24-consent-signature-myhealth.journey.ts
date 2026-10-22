import { expect, type Page, request, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { API_URL, ORGANIZATION_CODE, PATIENT_PASSWORD, STAFF } from "../support/env";
import { portalPage, staffPage, toast } from "../support/pages";

/**
 * Electronic signatures, phase 2 (migration 0121): the clinic asks a patient to sign a consent form; the patient reads it in
 * MyHealth and signs by drawing after confirming the password again. For a minor the clinic asks the parent: the parent opens
 * the child's MyHealth and signs as their representative. The signed forms and their evidence are on the records.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];
const adult = { id: "", number: "", family: "Signonline", given: "Alma", birthDate: "1988-05-20", email: "alma.signonline@e2e.ph" };
const parent = { id: "", number: "", family: "Signonline", given: "Pilar", birthDate: "1985-03-11", email: "pilar.signonline@e2e.ph" };
const child = { id: "", family: "Signonline", given: "Bino", requestId: "" };
const entry = { id: "", code: "SIGN-ONL", name: "Online consent dressing" };

let nurse: Page;
let alma: Page;
let pilar: Page;

/** A full-page screenshot kept with the test's output (and attached to the report). */
const shot = async (page: Page, name: string) => {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
};

/** Draws a signature across the pad inside the group and enters the password, ready to send. */
async function signOn(page: Page, group: string, password: string) {
  const form = page.getByRole("group", { name: group });
  await form.getByLabel("I have read this form and I agree to it.").check();
  const pad = form.getByRole("img", { name: /Signature pad/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.6);
  await page.mouse.down();
  for (const [x, y] of [
    [0.2, 0.2],
    [0.3, 0.75],
    [0.42, 0.25],
    [0.55, 0.7],
    [0.7, 0.3],
    [0.88, 0.55],
  ] as const) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
  }
  await page.mouse.up();
  await form.getByLabel("Your password, to confirm it is you").fill(password);
  return form;
}

async function register(api: Awaited<ReturnType<typeof staffApi>>, person: { family: string; given: string; birthDate: string }, mobile: string) {
  const created = await api.post<{ id: string; patientNumber: string }>("/patients", {
    familyName: person.family,
    givenName: person.given,
    sex: "female",
    birthDate: person.birthDate,
    contacts: [{ system: "mobile", value: mobile }],
  });
  await api.post(`/patients/${created.id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" });
  return created;
}

async function activate(api: Awaited<ReturnType<typeof staffApi>>, who: { id: string; number: string; birthDate: string; email: string }) {
  const { activationCode } = await api.post<{ activationCode: string }>(`/patients/${who.id}/portal-account/invitations`);
  const portal = await request.newContext();
  const response = await portal.post(`${API_URL}/portal/auth/activate`, {
    data: {
      organizationCode: ORGANIZATION_CODE,
      patientNumber: who.number,
      birthDate: who.birthDate,
      activationCode,
      email: who.email,
      password: PATIENT_PASSWORD,
    },
  });
  if (!response.ok()) throw new Error(`Portal activation failed: ${response.status()} ${await response.text()}`);
  await portal.dispose();
}

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const a = await register(api, adult, "0917 555 3131");
  adult.id = a.id;
  adult.number = a.patientNumber;
  await activate(api, adult);
  const p = await register(api, parent, "0917 555 3232");
  parent.id = p.id;
  parent.number = p.patientNumber;
  await activate(api, parent);
  // A child of seven, with the parent's grant to act (the clinic's own check is recorded with it).
  const year = new Date().getFullYear() - 7;
  const c = await register(api, { ...child, birthDate: `${year}-04-09` }, "0917 555 3333");
  child.id = c.id;
  await api.post(`/patients/${child.id}/portal-proxies`, {
    guardianPatientNumber: parent.number,
    relationship: "parent",
    basis: "parent_of_minor",
    verificationNote: "Birth certificate and ID seen at the front desk",
  });
  // The clinic turns signing in MyHealth on and offers a procedure with its own wording.
  const current = await api.get<{ version: number }>("/clinic/consent-signing/settings");
  await api.put("/clinic/consent-signing/settings", { minorAgeYears: 18, portalSigningEnabled: true, requestValidDays: 7, version: current.version });
  entry.id = (
    await api.post<{ id: string }>("/clinic/procedure-definitions", {
      code: entry.code,
      name: entry.name,
      consentRequired: true,
      allowedOutsideConsultation: true,
    })
  ).id;
  await api.post(`/clinic/procedure-definitions/${entry.id}/consent-wordings`, {
    title: "Consent to dressing",
    body: "I understand the dressing procedure, its purpose and the usual after-care.\n\nI have had the chance to ask questions and I agree to it being done.",
  });
  await api.dispose();
  nurse = await staffPage(browser, STAFF.nurse, errors);
  alma = await portalPage(browser, adult.email, errors);
  pilar = await portalPage(browser, parent.email, errors);
});

test.afterAll(async () => {
  await nurse?.context().close();
  await alma?.context().close();
  await pilar?.context().close();
  expect(errors, "page errors and server errors during the journey").toEqual([]);
});

test("the nurse asks the patient to sign, and the patient signs in MyHealth", async () => {
  await nurse.goto(`/patients/${adult.id}/procedures`);
  const panel = nurse.getByRole("region", { name: "Consent forms to sign in MyHealth" });
  await panel.getByLabel("Ask the patient to sign").selectOption({ label: `${entry.code} · ${entry.name}` });
  await panel.getByRole("button", { name: "Send for signature" }).click();
  await toast(nurse, "The form was sent to MyHealth");
  await expect(panel.getByText("Waiting for the signature")).toBeVisible();
  await shot(nurse, "1-nurse-asked");

  await alma.goto("/forms");
  await expect(alma.getByRole("heading", { name: "Forms to sign" })).toBeVisible();
  await expect(alma.getByRole("heading", { name: "Consent to dressing" })).toBeVisible();
  await expect(alma.getByText("usual after-care")).toBeVisible();
  const sign = alma.getByRole("button", { name: "Sign and send" });
  await expect(sign).toBeDisabled();
  await shot(alma, "2-patient-reads");

  // The wrong password is refused and the form stays.
  const form = await signOn(alma, "Sign Consent to dressing", "Not-my-password-1");
  await expect(sign).toBeEnabled();
  await shot(alma, "3-patient-signs");
  await sign.click();
  await expect(alma.getByText("The password is not correct.")).toBeVisible();
  await form.getByLabel("Your password, to confirm it is you").fill(PATIENT_PASSWORD);
  await sign.click();
  await expect(alma.getByText("Nothing to sign")).toBeVisible();
  await shot(alma, "4-patient-signed");

  await nurse.goto(`/patients/${adult.id}/procedures`);
  await expect(nurse.getByRole("region", { name: "Consent forms to sign in MyHealth" }).getByText("Signed", { exact: true })).toBeVisible();
  await shot(nurse, "5-nurse-sees-signed");
});

test("for a minor the parent signs, acting for the child", async () => {
  // At the clinic the child's own signature is refused: the API asks for a parent or guardian.
  await nurse.goto(`/patients/${child.id}/procedures`);
  const panel = nurse.getByRole("region", { name: "Consent forms to sign in MyHealth" });
  await panel.getByLabel("Ask the patient to sign").selectOption({ label: `${entry.code} · ${entry.name}` });
  await panel.getByRole("button", { name: "Send for signature" }).click();
  await toast(nurse, "The form was sent to MyHealth");
  await expect(panel.getByText("parent or guardian signs")).toBeVisible();
  await shot(nurse, "6-nurse-asked-for-minor");

  // The parent's own MyHealth has nothing to sign; opening the child's does.
  await pilar.goto("/forms");
  await expect(pilar.getByText("Nothing to sign")).toBeVisible();
  await pilar.goto("/people");
  await pilar.getByRole("button", { name: /^Open .*MyHealth$/ }).click();
  await pilar.waitForURL((url) => !url.pathname.startsWith("/people"));
  await pilar.goto("/forms");
  await expect(pilar.getByText("This patient is a minor, so a parent or guardian signs.")).toBeVisible();
  const sign = pilar.getByRole("button", { name: "Sign and send" });
  await signOn(pilar, "Sign Consent to dressing", PATIENT_PASSWORD);
  await shot(pilar, "7-parent-signs-for-child");
  await sign.click();
  await expect(pilar.getByText("Nothing to sign")).toBeVisible();
  await shot(pilar, "8-parent-signed");
});

test("the evidence names the account and, for the child, the parent's grant", async () => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const evidenceOf = async (patientId: string) => {
    const documents = await api.get<Array<{ id: string; category: string; title: string }>>(`/documents?patientId=${patientId}`);
    const signed = documents.find((d) => d.category === "consent_form");
    expect(signed, "the signed consent form").toBeDefined();
    expect(signed!.title).toBe("Consent to dressing (signed in MyHealth)");
    return api.get<Array<Record<string, unknown>>>(`/documents/${signed!.id}/signatures`);
  };
  const own = await evidenceOf(adult.id);
  expect(own).toHaveLength(1);
  expect(own[0]).toMatchObject({ signerKind: "patient", identityMethod: "portal_password", method: "drawn", witnessedBy: null });
  expect(own[0]).not.toHaveProperty("strokes");
  const forChild = await evidenceOf(child.id);
  expect(forChild[0]).toMatchObject({ signerKind: "representative", signerRelationship: "parent", identityMethod: "portal_password" });
  expect(forChild[0]!.proxyGrantId).toBeTruthy();
  expect(String(forChild[0]!.signerName)).toContain("Pilar");
  await api.dispose();
});
