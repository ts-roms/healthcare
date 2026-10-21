import { expect, type Page, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { DOCTOR_NAME, STAFF } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Electronic signatures, phase 1 (migration 0120): a nurse records a procedure that needs consent; the patient signs the
 * consent form on the tablet, the signed form is saved to the record and attached as the consent, and the evidence is on
 * the document (signer, how they were identified, the hash of the text agreed to; never the strokes).
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];
const patient = { id: "", family: "Signaturejourney", given: "Sofia" };
const entry = { id: "", code: "SIGN-DRESS", name: "Dressing with consent" };
let visitId = "";
let nurse: Page;

/** A full-page screenshot kept with the test's output (and attached to the report). */
const shot = async (page: Page, name: string) => {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
};

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const visitTypes = await api.get<Array<{ id: string; name: string }>>("/clinic/visit-types");
  patient.id = (
    await api.post<{ id: string }>("/patients", {
      familyName: patient.family,
      givenName: patient.given,
      sex: "female",
      birthDate: "1990-04-12",
      contacts: [{ system: "mobile", value: "0917 555 2323" }],
    })
  ).id;
  entry.id = (
    await api.post<{ id: string }>("/clinic/procedure-definitions", {
      code: entry.code,
      name: entry.name,
      requiresBodySite: false,
      consentRequired: true,
      allowedOutsideConsultation: true,
    })
  ).id;
  await api.post(`/clinic/procedure-definitions/${entry.id}/consent-wordings`, {
    title: "Consent to dressing",
    body: "I understand the dressing procedure, its purpose and the usual after-care.\n\nI have had the chance to ask questions and I agree to it being done.",
  });
  const walkIn = await api.post<{ id: string }>("/queue/walk-ins", {
    patientId: patient.id,
    visitTypeId: visitTypes.find((v) => v.name === "Consultation")!.id,
    chiefComplaint: "Wound check",
  });
  visitId = walkIn.id;
  await api.dispose();
  nurse = await staffPage(browser, STAFF.nurse, errors);
});

test.afterAll(async () => {
  await nurse?.context().close();
  expect(errors, "page errors and server errors during the journey").toEqual([]);
});

test("the patient signs the consent form on the tablet and it is attached to the procedure", async () => {
  await nurse.goto(`/queue/visits/${visitId}/procedures`);
  await nurse.getByRole("button", { name: "Record procedure" }).first().click();
  await nurse.getByLabel("Procedure *").selectOption({ label: `${entry.code} · ${entry.name}` });
  await expect(nurse.getByText("Consent is required for this procedure and recorded with it")).toBeVisible();
  await expect(nurse.getByText("Or print the form and link its scan.")).toBeVisible();
  await shot(nurse, "1-consent-part");

  await nurse.getByRole("button", { name: "Sign on screen" }).click();
  const form = nurse.getByRole("group", { name: "Sign the consent form" });
  const save = form.getByRole("button", { name: "Save signed form" });
  await expect(save).toBeDisabled();
  await form.getByLabel(/Signer.s name, as printed/).fill("Sofia Signaturejourney");
  await form.getByLabel("How did you identify the signer? *").fill("PhilSys card shown");
  // Not enough ink: a tap does not stand as a signature.
  const pad = form.getByRole("img", { name: /Signature pad/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await nurse.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(save).toBeDisabled();
  // A signature: a few loops across the pad.
  await nurse.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.6);
  await nurse.mouse.down();
  for (const [x, y] of [
    [0.2, 0.2],
    [0.3, 0.75],
    [0.42, 0.25],
    [0.55, 0.7],
    [0.7, 0.3],
    [0.88, 0.55],
  ] as const) {
    await nurse.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
  }
  await nurse.mouse.up();
  await expect(save).toBeEnabled();
  await shot(nurse, "2-signed-on-pad");

  await save.click();
  await toast(nurse, "Signed form saved and attached");
  await expect(nurse.getByText("Signed form attached below")).toBeVisible();
  await expect(nurse.getByLabel("Signed form (scan)")).toHaveValue(/[0-9a-f-]{36}/);
  await expect(nurse.getByLabel("Obtained *")).toHaveValue("electronic");
  await shot(nurse, "3-form-attached");

  // The nurse has no practitioner record of their own: the procedure is done on behalf of the doctor.
  await nurse.getByLabel("Performed by").selectOption({ label: DOCTOR_NAME });
  await nurse.getByRole("button", { name: "Record procedure" }).last().click();
  await toast(nurse, /recorded/);
  await expect(nurse.getByText("Consent recorded")).toBeVisible();
  await expect(nurse.getByText("signed form linked")).toBeVisible();
  await shot(nurse, "4-procedure-recorded");
});

test("the signed form and its evidence are on the patient record", async () => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  const documents = await api.get<Array<{ id: string; category: string; title: string; source: string }>>(`/documents?patientId=${patient.id}`);
  const signed = documents.find((d) => d.category === "consent_form");
  expect(signed, "the signed consent form").toBeDefined();
  expect(signed).toMatchObject({ title: "Consent to dressing (signed)", source: "generated" });

  const evidence = await api.get<Array<Record<string, unknown>>>(`/documents/${signed!.id}/signatures`);
  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({ signerKind: "patient", signerName: "Sofia Signaturejourney", identityCheck: "PhilSys card shown", method: "drawn" });
  expect(evidence[0]).not.toHaveProperty("strokes");
  await api.dispose();

  // The patient's procedures list shows the consent with its signed form linked.
  await nurse.goto(`/patients/${patient.id}/procedures`);
  await expect(nurse.getByText("Consent recorded")).toBeVisible();
  await expect(nurse.getByText("signed form linked")).toBeVisible();
  await shot(nurse, "5-on-the-record");
});
