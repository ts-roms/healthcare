import { expect, type Page, request, test } from "@playwright/test";
import { Client } from "pg";
import { staffApi } from "../support/api";
import { API_URL, E2E_DATABASE_URL, PORTAL_URL, STAFF, STAFF_PASSWORD } from "../support/env";
import { staffPage, toast, watchErrors } from "../support/pages";

/**
 * Outreach campaigns (libs/crm): a segment from non-clinical criteria with an audited preview, a campaign that a second
 * person approves, the run (only the patient who opted in to email is written to; the others are held back with the
 * reason), counts-only summary, and the opt-out link in the email that keeps the patient out of the next campaign.
 */
test.describe.configure({ mode: "serial" });

// The clinic is looked up from the API, not from the shared seed state file, so a concurrent run cannot change it.
let facilityId = "";
const errors: string[] = [];
const CITY = "Outreachville";
const PLANNER = "planner@e2e.ph";

const people = {
  optedIn: { id: "", given: "Yara", birth: "1980-05-05", family: "Outreachyes", email: "outreach.yes@e2e.ph", phone: "0917 555 0301" },
  noChoice: { id: "", given: "Zeny", birth: "1971-02-11", family: "Outreachsilent", email: "outreach.silent@e2e.ph", phone: "0917 555 0302" },
  optedOut: { id: "", given: "Wilma", birth: "1992-09-30", family: "Outreachno", email: "outreach.no@e2e.ph", phone: "0917 555 0303" },
};
const ids: { segmentAll?: string; segmentEmail?: string; first?: string; second?: string } = {};
let optOutLink = "";

let planner: Page;
let admin: Page;

/** The campaign's id from the page the planner is on. */
const campaignIdFrom = (page: Page): string => /\/outreach\/campaigns\/([0-9a-f-]{36})/.exec(page.url())![1]!;

async function db<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** PUT is not in the shared helper. */
async function putPreferences(token: string, patientId: string, preferences: unknown[]): Promise<void> {
  const context = await request.newContext();
  const response = await context.put(`${API_URL}/patients/${patientId}/communication-preferences`, {
    headers: { authorization: `Bearer ${token}`, "x-facility-id": facilityId },
    data: { preferences },
  });
  const text = await response.text();
  await context.dispose();
  if (!response.ok()) throw new Error(`PUT preferences → ${response.status()}: ${text}`);
}

async function accessToken(email: string): Promise<string> {
  const context = await request.newContext();
  const response = await context.post(`${API_URL}/auth/login`, { data: { email, password: STAFF_PASSWORD } });
  const body = (await response.json()) as { accessToken: string };
  await context.dispose();
  return body.accessToken;
}

async function newSegment(page: Page, name: string, optedInEmail: boolean): Promise<void> {
  await page.goto("/outreach");
  await page.getByRole("button", { name: "New segment" }).click();
  const form = page.getByRole("form", { name: "New segment" });
  await form.locator("#sg-name").fill(name);
  await form.locator("#sg-city").fill(CITY);
  if (optedInEmail) await form.locator("#sg-opt").selectOption({ label: "Email" });
  await form.getByRole("button", { name: "Save segment" }).click();
  await toast(page, "Segment saved");
}

async function newCampaign(page: Page, name: string, segmentName: string, body: string): Promise<string> {
  await page.goto("/outreach");
  await page.getByRole("button", { name: "New campaign" }).click();
  const form = page.getByRole("form", { name: "New campaign" });
  await form.locator("#cp-name").fill(name);
  await form.locator("#cp-segment").selectOption({ label: segmentName });
  await form.getByRole("checkbox", { name: "Text message" }).click();
  await form.getByRole("checkbox", { name: "Email" }).click();
  await form.locator("#cp-subject").fill("Free blood pressure checks");
  await form.locator("#cp-body").fill(body);
  await form.getByRole("button", { name: "Save draft" }).click();
  await toast(page, "Campaign drafted");
  await page.getByRole("link", { name }).click();
  await page.waitForURL(/\/outreach\/campaigns\/[0-9a-f-]{36}$/);
  return campaignIdFrom(page);
}

test.beforeAll(async ({ browser }) => {
  const bootstrap = await staffApi(STAFF.admin);
  facilityId = (await bootstrap.get<Array<{ id: string }>>("/facilities"))[0]!.id;
  await bootstrap.dispose();
  const api = await staffApi(STAFF.admin, facilityId);
  for (const person of Object.values(people)) {
    const created = await api.post<{ id: string }>("/patients", {
      familyName: person.family,
      givenName: person.given,
      sex: "female",
      birthDate: person.birth,
      contacts: [
        { system: "mobile", value: person.phone },
        { system: "email", value: person.email },
      ],
      addresses: [{ cityMunicipality: CITY, province: "Outreachprovince" }],
    });
    person.id = created.id;
  }
  // The patients' own choices: one opted in to outreach by email, one opted out, one never chose.
  const token = await accessToken(STAFF.admin);
  await putPreferences(token, people.optedIn.id, [{ channel: "email", category: "outreach", optedIn: true }]);
  await putPreferences(token, people.optedOut.id, [{ channel: "email", category: "outreach", optedIn: false }]);

  // A planner who may draft and submit, but is not the one who approves in these journeys: no seeded role holds the
  // outreach permissions except the administrator's, so the administrator makes one.
  const permissions = ["crm.read", "crm.segment.manage", "crm.campaign.manage", "crm.campaign.approve", "patient.read", "notification.read"];
  const role = await api.post<{ id: string }>("/roles", { key: "outreach_planner", name: "Outreach planner", permissions });
  const user = await api.post<{ id: string }>("/users", { email: PLANNER, displayName: "Olga Planner", initialPassword: STAFF_PASSWORD });
  await api.post(`/users/${user.id}/role-assignments`, { roleId: role.id });
  await api.dispose();

  planner = await staffPage(browser, PLANNER, errors);
  admin = await staffPage(browser, STAFF.admin, errors);
});

test.afterAll(async () => {
  await planner?.context().close();
  await admin?.context().close();
});

test("a segment is defined from non-clinical criteria, and its preview lists who matches", async () => {
  await newSegment(planner, "Outreach city", false);
  await newSegment(planner, "Outreach city, email opt-in", true);
  const segments = await db<{ id: string; name: string }>(`SELECT id, name FROM crm_segment WHERE name LIKE 'Outreach city%'`);
  ids.segmentAll = segments.find((s) => s.name === "Outreach city")!.id;
  ids.segmentEmail = segments.find((s) => s.name === "Outreach city, email opt-in")!.id;

  const row = planner.getByRole("listitem").filter({ hasText: "Outreach city" }).filter({ hasNotText: "email opt-in" });
  await row.getByRole("button", { name: "Preview" }).click();
  await expect(row.getByText("3 patients match today.")).toBeVisible();
  for (const person of Object.values(people)) await expect(row.getByText(new RegExp(person.family, "i"))).toBeVisible();

  const optInRow = planner.getByRole("listitem").filter({ hasText: "Outreach city, email opt-in" });
  await optInRow.getByRole("button", { name: "Preview" }).click();
  await expect(optInRow.getByText("1 patient match today.")).toBeVisible();
  await expect(optInRow.getByText(new RegExp(people.optedIn.family, "i"))).toBeVisible();

  // Every preview is audited (counts only).
  const audited = await db<{ n: string }>(`SELECT count(*)::text AS n FROM audit_event WHERE action = 'crm.segment.preview' AND resource_id = ANY($1)`, [
    [ids.segmentAll, ids.segmentEmail],
  ]);
  expect(Number(audited[0]!.n)).toBeGreaterThanOrEqual(2);
});

test("the author cannot approve a campaign; a second person approves it", async () => {
  ids.first = await newCampaign(
    planner,
    "Outreach blood pressure week",
    "Outreach city",
    "Our clinic offers free blood pressure checks this month. Walk in any weekday morning.",
  );
  await planner.getByRole("button", { name: "Submit for approval" }).click();
  await toast(planner, "Submitted for approval");
  // The planner holds the approval permission but wrote and submitted it: the button is off and the page says why.
  await expect(planner.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(planner.getByText("You wrote or submitted this campaign, so someone else must approve it.")).toBeVisible();

  // The API refuses too, whatever the screen shows.
  const token = await accessToken(PLANNER);
  const context = await request.newContext();
  const campaign = await (await context.get(`${API_URL}/outreach/campaigns/${ids.first}`, { headers: { authorization: `Bearer ${token}` } })).json();
  const refused = await context.post(`${API_URL}/outreach/campaigns/${ids.first}/approve`, {
    headers: { authorization: `Bearer ${token}` },
    data: { version: (campaign as { version: number }).version },
  });
  expect(refused.status()).toBe(403);
  expect(JSON.stringify(await refused.json())).toContain("approver_is_author");
  await context.dispose();

  await admin.goto(`/outreach/campaigns/${ids.first}`);
  await expect(admin.getByText("Awaiting approval").first()).toBeVisible();
  await admin.getByRole("button", { name: "Approve" }).click();
  await toast(admin, "Approved");
  await expect(admin.getByText(/Approved .* by someone other than the author/)).toBeVisible();
});

test("the run writes only to the patient who opted in; the others are held back with the reason", async () => {
  // The campaign runner ticks every minute inside the API.
  const owner = await staffApi(STAFF.admin, facilityId);
  await expect
    .poll(async () => (await owner.get<{ status: string }>(`/outreach/campaigns/${ids.first}`)).status, { timeout: 150_000, intervals: [2_000] })
    .toBe("completed");
  await owner.dispose();

  const deliveries = await db<{ patient_id: string; channel: string; outcome: string; reason: string | null }>(
    `SELECT patient_id, channel, outcome, reason FROM crm_campaign_delivery WHERE campaign_id = $1`,
    [ids.first],
  );
  const of = (id: string) => deliveries.filter((d) => d.patient_id === id);
  expect(of(people.optedIn.id).map((d) => d.channel)).toEqual(["email"]);
  expect(["queued", "delivered"]).toContain(of(people.optedIn.id)[0]!.outcome);
  for (const silent of [people.noChoice, people.optedOut]) {
    expect(of(silent.id)).toHaveLength(1);
    expect(of(silent.id)[0]).toMatchObject({ channel: "email", outcome: "suppressed" });
    expect(of(silent.id)[0]!.reason).toBeTruthy();
  }
  // Nobody got a text message: the campaign was for email only.
  expect(deliveries.every((d) => d.channel === "email")).toBe(true);

  // The page shows counts only, never who.
  await admin.goto(`/outreach/campaigns/${ids.first}`);
  await expect(admin.getByText("Completed").first()).toBeVisible();
  await expect(admin.getByText(/3 patients in the segment when it was sent/)).toBeVisible();
  const emailRow = admin.getByRole("row").filter({ hasText: "Email" });
  await expect(emailRow.getByRole("cell").nth(4)).toHaveText("0");
  await expect(admin.getByText(/Not sent: .*\(\d\)/)).toBeVisible();
  for (const person of Object.values(people)) await expect(admin.getByText(person.family)).toHaveCount(0);

  // What each patient was sent is in the communication log.
  await admin.goto(`/patients/${people.optedIn.id}/communications`);
  await expect(admin.getByText("Outreach campaign").first()).toBeVisible();
  await admin.goto(`/patients/${people.noChoice.id}/communications`);
  await expect(admin.getByText("Outreach campaign").first()).toBeVisible();
});

let optOutToken = "";

test("the opt-out link in the email carries a single-use token that records the patient's opt-out", async () => {
  const [mail] = await db<{ link: string | null }>(
    `SELECT variables->>'optOutLink' AS link FROM notification WHERE recipient_patient_id = $1 AND template_key = 'outreach.campaign' AND channel = 'email'`,
    [people.optedIn.id],
  );
  optOutLink = mail?.link ?? "";
  expect(optOutLink).toContain(`${PORTAL_URL}/outreach/opt-out?token=`);
  optOutToken = new URL(optOutLink).searchParams.get("token")!;

  // What the MyHealth page does with the token: the public API call, with no sign-in.
  const context = await request.newContext();
  const first = await context.post(`${API_URL}/outreach/opt-out`, { data: { token: optOutToken } });
  expect(await first.json()).toMatchObject({ recorded: true, channel: "email" });
  // Single use: the same link answers "not recorded" and never says whether it ever existed.
  const again = await context.post(`${API_URL}/outreach/opt-out`, { data: { token: optOutToken } });
  expect(await again.json()).toMatchObject({ recorded: false });
  await context.dispose();

  const [preference] = await db<{ opted_in: boolean }>(
    `SELECT opted_in FROM patient_communication_preference WHERE patient_id = $1 AND channel = 'email' AND category = 'outreach'`,
    [people.optedIn.id],
  );
  expect(preference!.opted_in).toBe(false);
});

// The link in the email works without signing in: MyHealth's proxy leaves /outreach/opt-out open. The token was used by
// the API step above, so the page says so (a valid link records the opt-out; the answer never depends on being signed in).
test("the opt-out page opens from the email link without signing in", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  watchErrors(page, "patient (opt-out link)", errors);
  await page.goto(`${PORTAL_URL}/outreach/opt-out?token=${optOutToken}`);
  expect(new URL(page.url()).pathname).toBe("/outreach/opt-out");
  await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
  await context.close();
});

test("after the opt-out, a new campaign leaves the patient out", async () => {
  // The opted-in-by-email segment no longer finds her.
  await planner.goto("/outreach");
  const optInRow = planner.getByRole("listitem").filter({ hasText: "Outreach city, email opt-in" });
  await optInRow.getByRole("button", { name: "Preview" }).click();
  await expect(optInRow.getByText("0 patients match today.")).toBeVisible();

  ids.second = await newCampaign(
    planner,
    "Outreach second round",
    "Outreach city",
    "A reminder that our blood pressure checks continue until the end of the month.",
  );
  await planner.getByRole("button", { name: "Submit for approval" }).click();
  await toast(planner, "Submitted for approval");
  await admin.goto(`/outreach/campaigns/${ids.second}`);
  await admin.getByRole("button", { name: "Approve" }).click();
  await toast(admin, "Approved");

  const owner = await staffApi(STAFF.admin, facilityId);
  await expect
    .poll(async () => (await owner.get<{ status: string }>(`/outreach/campaigns/${ids.second}`)).status, { timeout: 150_000, intervals: [2_000] })
    .toBe("completed");
  await owner.dispose();

  const deliveries = await db<{ patient_id: string; outcome: string }>(`SELECT patient_id, outcome FROM crm_campaign_delivery WHERE campaign_id = $1`, [
    ids.second,
  ]);
  expect(deliveries).toHaveLength(3);
  expect(deliveries.every((d) => d.outcome === "suppressed")).toBe(true);
  const emails = await db<{ n: string }>(
    `SELECT count(*)::text AS n FROM notification WHERE recipient_patient_id = $1 AND template_key = 'outreach.campaign' AND status <> 'suppressed'`,
    [people.optedIn.id],
  );
  expect(Number(emails[0]!.n)).toBe(1);
  expect(errors).toEqual([]);
});
