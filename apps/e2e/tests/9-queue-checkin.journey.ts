import { expect, type Locator, type Page, test } from "@playwright/test";
import { loadState, staffApi } from "../support/api";
import { DOCTOR_NAME, STAFF } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * Patient check-in and the queue: walk-in and appointment check-in, priority order on the board, calling, moving
 * along, closing a visit with a reason, triage with a priority and a route, and sending a patient through service
 * points (Done here / Skip step), with a second browser seeing the board change without a reload.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];

interface Person {
  id: string;
  family: string;
}
const people: Record<"walkin" | "urgent" | "appointment" | "triage", Person> = {
  walkin: { id: "", family: "Queuewalk" },
  urgent: { id: "", family: "Queueurgent" },
  appointment: { id: "", family: "Queueappt" },
  triage: { id: "", family: "Queuetriage" },
};
const tickets: Partial<Record<keyof typeof people, string>> = {};
const triageRoom = { id: "", name: "Triage Room" };
const xray = { id: "", name: "X-ray" };
const counter = { id: "", name: "Counter" };

let desk: Page;
let admin: Page;
let watcher: Page;

const column = (page: Page, label: string): Locator => page.getByRole("region", { name: label, exact: true });
const card = (scope: Locator | Page, person: Person): Locator => scope.getByRole("button", { name: new RegExp(`A-\\d+.*${person.family}`, "i") });
const panel = (page: Page, person: Person): Locator => page.getByRole("complementary", { name: new RegExp(`^Ticket ${tickets[personKey(person)]}$`) });
const personKey = (person: Person) => Object.keys(people).find((k) => people[k as keyof typeof people] === person) as keyof typeof people;

async function openTicket(page: Page, person: Person): Promise<Locator> {
  await page.goto("/queue");
  await card(page, person).click();
  const aside = panel(page, person);
  await expect(aside).toBeVisible();
  return aside;
}

async function walkIn(page: Page, person: Person, options: { visitType: string; priority?: "Urgent" | "Emergency"; complaint: string }): Promise<string> {
  await page.goto(`/queue/walk-in?patientId=${person.id}`);
  await page.locator("#visitType").selectOption({ label: options.visitType });
  if (options.priority) await page.locator("#priority").selectOption({ label: options.priority });
  await page.locator("#complaint").fill(options.complaint);
  await page.getByRole("button", { name: "Check in" }).click();
  const ticket = /ticket (A-\d{3})/.exec(await toast(page, /Checked in — ticket A-\d{3}/))![1]!;
  await page.waitForURL(/\/queue$/);
  return ticket;
}

test.beforeAll(async ({ browser }) => {
  const api = await staffApi(STAFF.admin, state.facilityId);
  for (const [key, person] of Object.entries(people)) {
    const created = await api.post<{ id: string }>("/patients", {
      familyName: person.family,
      givenName: "Pat",
      sex: key === "urgent" ? "male" : "female",
      birthDate: "1985-03-14",
      contacts: [{ system: "mobile", value: "0917 555 02" + String(10 + Object.keys(people).indexOf(key)) }],
    });
    person.id = created.id;
  }
  // A visit type that needs triage, and three service points to route through.
  await api.post("/clinic/visit-types", { code: "triage-visit", name: "Triage visit", defaultDurationMinutes: 15, requiresTriage: true });
  const point = (code: string, name: string, kind: string, location: string) =>
    api.post<{ id: string }>("/clinic/service-points", { facilityId: state.facilityId, code, name, kind, location });
  triageRoom.id = (await point("triage-room", triageRoom.name, "consultation", "Triage 1")).id;
  xray.id = (await point("xray", xray.name, "imaging", "X-ray room")).id;
  counter.id = (await point("counter", counter.name, "other", "Counter 3")).id;
  await api.dispose();

  desk = await staffPage(browser, STAFF.desk, errors);
  admin = await staffPage(browser, STAFF.admin, errors);
  watcher = await staffPage(browser, STAFF.doctor, errors);
  await watcher.goto("/queue");
});

test.afterAll(async () => {
  await desk?.context().close();
  await admin?.context().close();
  await watcher?.context().close();
});

test("the front desk checks a walk-in in, and another browser sees the ticket without reloading", async () => {
  tickets.walkin = await walkIn(desk, people.walkin, { visitType: "Consultation", complaint: "Sore throat for two days" });
  await expect(column(desk, "Waiting").getByRole("button", { name: new RegExp(`${tickets.walkin}.*${people.walkin.family}`, "i") })).toBeVisible();
  // Live: the doctor's open queue shows it (socket, or the 15-second poll as the fallback).
  await expect(card(watcher, people.walkin)).toBeVisible({ timeout: 30_000 });
});

test("an urgent walk-in checked in later is served before the routine one", async () => {
  tickets.urgent = await walkIn(desk, people.urgent, { visitType: "Consultation", priority: "Urgent", complaint: "Chest tightness" });
  const waiting = column(desk, "Waiting").getByRole("button");
  await expect(waiting.filter({ hasText: new RegExp(people.urgent.family, "i") })).toBeVisible();
  const names = await waiting.allInnerTexts();
  const at = (person: Person) => names.findIndex((text) => new RegExp(person.family, "i").test(text));
  expect(at(people.urgent)).toBeGreaterThanOrEqual(0);
  expect(at(people.walkin)).toBeGreaterThanOrEqual(0);
  expect(at(people.urgent)).toBeLessThan(at(people.walkin));
  await card(desk, people.urgent).click();
  await expect(panel(desk, people.urgent).getByText("Urgent", { exact: true })).toBeVisible();
});

test("a booked patient checks in for the appointment and gets a ticket", async () => {
  await desk.goto(`/appointments/new?patientId=${people.appointment.id}`);
  await desk.locator("#practitioner").selectOption({ label: DOCTOR_NAME });
  await desk.waitForURL(/practitionerId=/);
  await desk.locator("#visitType").selectOption({ label: "Consultation · 15 min" });
  await desk.waitForURL(/visitTypeId=/);
  await desk.locator("#reason").fill("Follow-up of blood pressure");
  await desk.getByRole("radiogroup", { name: "Open slots" }).getByRole("radio").first().click();
  await desk.getByRole("button", { name: /^Book \d/ }).click();
  await toast(desk, new RegExp(`Booked ${people.appointment.family}`, "i"));
  await desk.waitForURL(/\/appointments\?/);
  await desk.getByRole("button", { name: "Check in" }).first().click();
  tickets.appointment = /ticket (A-\d{3})/.exec(await toast(desk, /Checked in .* ticket A-\d{3}/))![1]!;

  const aside = await openTicket(desk, people.appointment);
  await expect(aside.getByText("Appointment", { exact: true })).toBeVisible();
  await expect(aside.getByText("Checked in for the appointment")).toBeVisible();
});

test("reception calls a patient to a room", async () => {
  const aside = await openTicket(desk, people.urgent);
  await aside.getByLabel("Call patient to").fill("Room 2");
  await aside.getByRole("button", { name: "Call", exact: true }).click();
  await toast(desk, `${tickets.urgent} called to Room 2`);
  await expect(panel(desk, people.urgent).getByText("Called to Room 2")).toBeVisible();
});

test("a ticket is moved along, then closed with a reason", async () => {
  const aside = await openTicket(desk, people.walkin);
  await aside.getByRole("button", { name: "Move to Triage / Vitals" }).click();
  await toast(desk, `${tickets.walkin}: Send to triage`);
  await expect(card(column(desk, "Triage / Vitals"), people.walkin)).toBeVisible();

  await panel(desk, people.walkin).getByRole("button", { name: "Move to Ready for provider" }).click();
  await toast(desk, `${tickets.walkin}: Ready for provider`);
  await expect(card(column(desk, "Ready for provider"), people.walkin)).toBeVisible();

  // Leaving is recorded with a reason (the audit trail), never silently.
  await panel(desk, people.walkin).getByRole("button", { name: "Left without being seen…" }).click();
  const submit = panel(desk, people.walkin).getByRole("button", { name: "Left without being seen", exact: true });
  await expect(submit).toBeDisabled();
  await panel(desk, people.walkin)
    .getByLabel(/Reason for/)
    .fill("Left before being called");
  await submit.click();
  await toast(desk, `${tickets.walkin}: Left without being seen`);
  await expect(card(column(desk, "Ready for provider"), people.walkin)).toHaveCount(0);
  await expect(card(column(desk, "Waiting"), people.walkin)).toHaveCount(0);
});

test("triage records vital signs and an urgent priority, and plans a route through service points", async () => {
  tickets.triage = await walkIn(desk, people.triage, { visitType: "Triage visit", complaint: "Fever and cough" });

  // A visit type that needs triage waits for it: the nurse opens it from the ticket.
  await admin.goto("/queue");
  await card(admin, people.triage).click();
  await panel(admin, people.triage).getByRole("link", { name: "Triage & vitals" }).click();
  await admin.waitForURL(/\/queue\/visits\/[0-9a-f-]{36}\/triage$/);

  await admin.locator("#temperatureC").fill("39.4");
  await admin.locator("#heartRateBpm").fill("112");
  await admin.locator("#spo2Percent").fill("94");
  await admin.getByRole("radio", { name: /Urgent/ }).click();
  await admin.locator("#servicePointId").selectOption({ label: `${triageRoom.name} · Consultation` });
  await admin.locator("#routeStop").selectOption({ label: `${xray.name} · Imaging` });
  await admin.getByRole("button", { name: "Add stop" }).click();
  await admin.locator("#routeStop").selectOption({ label: `${counter.name} · Other` });
  await admin.getByRole("button", { name: "Add stop" }).click();
  await admin.getByRole("button", { name: "Complete triage" }).click();
  await toast(admin, new RegExp(`${tickets.triage}: triage complete, ready for provider · sent to ${triageRoom.name}, then ${xray.name} → ${counter.name}`));
  await admin.waitForURL(/\/queue$/);

  const aside = await openTicket(admin, people.triage);
  await expect(aside.getByText("Urgent", { exact: true })).toBeVisible();
  await expect(aside.getByText(triageRoom.name).first()).toBeVisible();
  await expect(card(column(admin, "Ready for provider"), people.triage)).toBeVisible();
});

test("the patient is sent on stop by stop, a step is skipped with a reason, and each service point has its own queue", async () => {
  const aside = await openTicket(admin, people.triage);
  await aside.getByRole("button", { name: "Done here, send on" }).click();
  await panel(admin, people.triage).getByRole("button", { name: "Send on", exact: true }).click();
  await toast(admin, `${tickets.triage} sent on`);
  await expect(panel(admin, people.triage).getByText(xray.name).first()).toBeVisible();

  // Each service point shows only its own tickets.
  await admin.goto(`/queue?servicePoint=${xray.id}`);
  await expect(card(admin, people.triage)).toBeVisible();
  await admin.goto(`/queue?servicePoint=${triageRoom.id}`);
  await expect(card(admin, people.triage)).toHaveCount(0);

  // The last planned stop is skipped, with a reason; the route is then complete.
  const again = await openTicketAt(admin, people.triage, xray.id);
  await again.getByRole("button", { name: "Skip step…" }).click();
  await again.getByLabel("Step to skip *").selectOption({ label: counter.name });
  await again.getByLabel("Reason *").fill("Patient declined the counter visit");
  await again.getByRole("button", { name: "Skip step", exact: true }).click();
  await toast(admin, `${tickets.triage}: step skipped`);
});

test("a ticket is sent to another service point directly, and nothing broke along the way", async () => {
  const aside = await openTicket(desk, people.appointment);
  await aside.getByRole("button", { name: "Move to Triage / Vitals" }).click();
  await toast(desk, `${tickets.appointment}: Send to triage`);
  await panel(desk, people.appointment)
    .getByLabel("Send to")
    .selectOption({ label: `${counter.name} · Other` });
  await panel(desk, people.appointment).getByRole("button", { name: "Send", exact: true }).click();
  await toast(desk, `${tickets.appointment} sent to ${counter.name}`);
  await expect(panel(desk, people.appointment).getByText(counter.name).first()).toBeVisible();
  expect(errors).toEqual([]);
});

async function openTicketAt(page: Page, person: Person, servicePointId: string): Promise<Locator> {
  await page.goto(`/queue?servicePoint=${servicePointId}`);
  await card(page, person).click();
  const aside = panel(page, person);
  await expect(aside).toBeVisible();
  return aside;
}
