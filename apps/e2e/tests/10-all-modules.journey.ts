import { expect, type Page, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { STAFF } from "../support/env";
import { staffPage } from "../support/pages";

/**
 * Every module's screens open for the administrator on a clinic with doctors and patients: no server error, no page
 * error, no sign-in bounce and no error page. This is a smoke pass over the whole staff app (the journeys above go deep
 * on the critical paths); it also visits the screens of one patient across the modules that keep a record per patient.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];

const MODULES: Record<string, string[]> = {
  "Patients and clinic": [
    "/",
    "/patients",
    "/patients/new",
    "/appointments",
    "/appointments/schedules",
    "/appointments/visit-types",
    "/appointments/waitlist",
    "/calendar",
    "/doctors",
    "/queue",
    "/clinic/encounters",
    "/clinic/care-plans",
    "/clinic/prescriptions",
    "/clinic/procedures",
    "/clinic/referrals",
    "/clinic/referrals/settings",
    "/clinic/vaccines",
    "/clinic/coding-systems",
    "/pharmacy",
  ],
  Telemedicine: ["/telemedicine"],
  Laboratory: [
    "/laboratory",
    "/laboratory/worklist",
    "/laboratory/critical",
    "/laboratory/catalog",
    "/laboratory/send-outs",
    "/laboratory/instruments",
    "/laboratory/instrument-results",
    "/laboratory/qc",
    "/laboratory/reagents",
    "/laboratory/temperatures",
    "/laboratory/nonconformances",
    "/laboratory/eqa",
    "/laboratory/competency",
    "/laboratory/licence",
  ],
  Dental: ["/dental", "/dental/settings"],
  Billing: ["/billing", "/billing/invoices", "/billing/reports", "/billing/settings"],
  Inventory: [
    "/inventory",
    "/inventory/catalog",
    "/inventory/movements",
    "/inventory/purchase-orders",
    "/inventory/supplier-invoices",
    "/inventory/valuation",
    "/inventory/controlled-register",
    "/inventory/compliance",
  ],
  "Patient communication": ["/messages", "/messages/settings", "/communications", "/outreach", "/notifications"],
  "Records and reporting": [
    "/records",
    "/records/requests",
    "/records/requests/settings",
    "/records/imports",
    "/records/integrity",
    "/records/retention",
    "/reporting",
    "/reporting/settings",
    "/management",
    "/management/reports",
  ],
  Administration: [
    "/admin",
    "/admin/users",
    "/admin/roles",
    "/admin/facilities",
    "/admin/organization",
    "/admin/service-points",
    "/admin/audit",
    "/admin/security",
    "/admin/privacy",
    "/admin/compliance",
    "/admin/consent-wording",
    "/admin/integrations",
  ],
  "Account and help": ["/account", "/help", "/offline"],
};

let admin: Page;
let patientId = "";

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  // A second doctor's patient for the per-patient screens.
  patientId = (
    await api.post<{ id: string }>("/patients", {
      familyName: "Allmodules",
      givenName: "Rica",
      sex: "female",
      birthDate: "1979-09-09",
      contacts: [{ system: "mobile", value: "0917 555 0390" }],
    })
  ).id;
  await api.dispose();
  admin = await staffPage(browser, STAFF.admin, errors);
});

test.afterAll(async () => {
  await admin?.context().close();
});

/** Opens a screen and fails on a server error, a page error, a sign-in bounce or an error page. */
async function open(path: string): Promise<void> {
  const response = await admin.goto(path);
  expect(response?.status(), `${path} status`).toBeLessThan(500);
  await admin.waitForLoadState("networkidle").catch(() => undefined);
  expect(new URL(admin.url()).pathname, `${path} bounced to sign-in`).not.toBe("/login");
  await expect(admin.locator("main, [role=main]").first(), `${path} shows no page`).toBeVisible();
  await expect(
    admin.getByText(/application error|something went wrong|this page could not be found|internal server error/i),
    `${path} shows an error page`,
  ).toHaveCount(0);
}

for (const [module, paths] of Object.entries(MODULES)) {
  test(`${module}: every screen opens`, async () => {
    for (const path of paths) await open(path);
    expect(errors).toEqual([]);
  });
}

test("one patient's record opens in every module that keeps one", async () => {
  for (const path of [
    `/patients/${patientId}`,
    `/patients/${patientId}/360`,
    `/patients/${patientId}/timeline`,
    `/patients/${patientId}/history`,
    `/patients/${patientId}/immunizations`,
    `/patients/${patientId}/procedures`,
    `/patients/${patientId}/communications`,
    `/patients/${patientId}/edit`,
    `/dental/patients/${patientId}`,
    `/billing/patients/${patientId}`,
    `/queue/walk-in?patientId=${patientId}`,
    `/appointments/new?patientId=${patientId}`,
  ]) {
    await open(path);
  }
  expect(errors).toEqual([]);
});
