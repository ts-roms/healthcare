import { expect, type Page, test } from "@playwright/test";
import { loadState, type StaffApi, staffApi } from "../support/api";
import { KIOSK_URL, STAFF, STAFF_PASSWORD } from "../support/env";
import { watchErrors } from "../support/pages";

/**
 * The kiosk when things go wrong or take a different path (docs/security/kiosk-audit-phase-6.md, KA-11): a booked patient
 * checks in for the appointment, a response lost on the way back does not make a second ticket, and a connection that drops
 * while someone is typing ends in plain words and a screen that starts again by itself once the connection is back.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];

let kiosk: Page;
let desk: StaffApi;
let n = 0;

interface Person {
  number: string;
  given: string;
  birthDate: string;
}

/** A patient registered by the front desk, ready to identify at the kiosk. */
async function newPerson(): Promise<Person & { id: string }> {
  n += 1;
  const birthDate = `19${70 + (n % 20)}-0${1 + (n % 9)}-${10 + (n % 18)}`;
  // Registered by the front desk's session opened once for the file (a sign-in per person would use the API's sign-in allowance).
  const created = await desk.post<{ id: string; patientNumber: string }>("/patients", {
    familyName: `Resilient${n}x`,
    givenName: `Given${n}`,
    sex: "female",
    birthDate,
    contacts: [{ system: "mobile", value: `0917 555 ${String(3000 + n)}` }],
  });
  return { id: created.id, number: created.patientNumber, given: `Given${n}`, birthDate };
}

async function identify(who: Person) {
  const [year, month, day] = who.birthDate.split("-") as [string, string, string];
  await kiosk.goto("/");
  await kiosk.getByRole("button", { name: "Touch here to check in" }).click();
  await kiosk.getByRole("button", { name: "Yes, I am a patient here" }).click();
  await kiosk.locator("#key").fill(who.number);
  await kiosk.locator("#birth-day").fill(String(Number(day)));
  await kiosk.locator("#birth-month").selectOption(String(Number(month)));
  await kiosk.locator("#birth-year").fill(year);
  await kiosk.locator("#givenName").fill(who.given);
}

const ticketOf = async () => /A-\d{3}/.exec(await kiosk.getByLabel("Your queue ticket").innerText())![0];
const queueEntries = async (ticket: string) => (await desk.get<Array<{ ticket: string }>>("/queue")).filter((r) => r.ticket === ticket).length;

test.beforeAll(async ({ browser }) => {
  desk = await staffApi(STAFF.desk, state.facilityId);
  const context = await browser.newContext({ baseURL: KIOSK_URL, viewport: { width: 1080, height: 1920 }, hasTouch: true });
  kiosk = await context.newPage();
  watchErrors(kiosk, "kiosk", errors);
  // The API allows about ten sign-ins a minute; earlier journeys may have used them: wait out the window once.
  for (let attempt = 1; ; attempt += 1) {
    await kiosk.goto("/setup");
    await kiosk.locator("#email").fill(STAFF.kiosk);
    await kiosk.locator("#password").fill(STAFF_PASSWORD);
    await kiosk.getByRole("button", { name: "Sign in this kiosk" }).click();
    const outcome = await Promise.race([
      kiosk
        .getByRole("heading", { name: "Welcome" })
        .waitFor({ timeout: 20_000 })
        .then(() => "signed-in" as const),
      kiosk
        .getByRole("alert")
        .filter({ hasText: /Too Many|rate|try again/i })
        .first()
        .waitFor({ timeout: 20_000 })
        .then(() => "throttled" as const),
    ]).catch(() => "timeout" as const);
    if (outcome === "signed-in") break;
    if (attempt >= 2 || outcome === "timeout") throw new Error(`The kiosk could not sign in (${outcome})`);
    await kiosk.waitForTimeout(61_000);
  }
});

/** The failures these journeys cause on purpose are not page errors to report. */
const DELIBERATE = /502|Bad gateway|ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|Load failed/i;

test.afterAll(async () => {
  await desk.dispose();
  await kiosk.context().close();
  expect(
    errors.filter((e) => !DELIBERATE.test(e)),
    "console or page errors",
  ).toEqual([]);
});

test("a booked patient checks in for the appointment at the kiosk and the front desk sees the visit", async () => {
  const who = await newPerson();
  // Booked inside the check-in window (an hour before to fifteen minutes after the start); another journey may already hold
  // the doctor at one of these times, so the next is tried.
  let booked: { id: string } | undefined;
  for (const minutes of [5, 25, 45, -10]) {
    try {
      [booked] = await desk.post<Array<{ id: string }>>("/appointments", {
        patientId: who.id,
        practitionerId: state.practitionerId,
        facilityId: state.facilityId,
        visitTypeId: state.consultVisitTypeId,
        startsAt: new Date(Date.now() + minutes * 60_000).toISOString(),
        outsideSchedule: true,
        reason: "Kiosk appointment check-in",
      });
      break;
    } catch (error) {
      if (!String((error as Error).message).includes("slot_unavailable")) throw error;
    }
  }
  expect(booked, "a free time for the doctor inside the check-in window").toBeTruthy();

  await identify(who);
  await kiosk.getByRole("button", { name: "Continue" }).click();
  await expect(kiosk.getByRole("heading", { name: "Your appointments today" })).toBeVisible();
  await expect(kiosk.getByText("Consultation").first()).toBeVisible();
  // Nobody else's appointment, and not the patient's name, is on the screen.
  await expect(kiosk.locator("body")).not.toContainText(`Resilient${n}x`);
  await kiosk.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(kiosk.getByRole("heading", { name: "You are checked in" })).toBeVisible();
  const ticket = await ticketOf();

  const board = (await desk.get<Array<{ ticket: string; checkedInVia: string; appointmentId?: string | null }>>("/queue")).find((r) => r.ticket === ticket);
  expect(board?.checkedInVia).toBe("kiosk");
  const appointment = await desk.get<{ status: string }>(`/appointments/${booked!.id}`);
  expect(appointment.status).toBe("checked_in");
});

test("a response lost on the way back does not make a second ticket: tapping again shows the same one", async () => {
  const who = await newPerson();
  await identify(who);
  await kiosk.getByRole("button", { name: "Continue" }).click();
  await expect(kiosk.getByRole("heading", { name: "What are you here for?" })).toBeVisible();

  // The first check-in reaches the kiosk's server and succeeds, but its answer never reaches the screen.
  let dropped = false;
  let answered = false;
  await kiosk.route("**/*", async (route) => {
    const request = route.request();
    if (!dropped && request.method() === "POST" && request.headers()["next-action"]) {
      dropped = true;
      await route.fetch();
      await route.fulfill({ status: 502, contentType: "text/plain", body: "Bad gateway" });
      answered = true;
      return;
    }
    await route.continue();
  });
  await kiosk.getByRole("button", { name: state.kioskVisitType.name }).click();
  await expect.poll(() => answered).toBe(true);
  // Whatever the screen shows now, it is plain words and a way forward — then the person taps again.
  await kiosk.unroute("**/*");
  const again = kiosk.getByRole("button", { name: state.kioskVisitType.name });
  if (await again.isVisible().catch(() => false)) await again.click();
  await expect(kiosk.getByRole("heading", { name: "You are checked in" })).toBeVisible({ timeout: 20_000 });
  const ticket = await ticketOf();

  // One entry in the queue, not two.
  expect(await queueEntries(ticket)).toBe(1);
  const visits = (await desk.get<Array<{ ticket: string; patientId?: string }>>("/queue")).filter((r) => r.ticket === ticket);
  expect(visits).toHaveLength(1);
});

test("a connection that drops while someone is typing ends in plain words, and the kiosk starts again once it is back", async () => {
  const who = await newPerson();
  await identify(who);
  await kiosk.context().setOffline(true);
  await kiosk.getByRole("button", { name: "Continue" }).click();
  // Plain words, no technical detail, and the front desk named; never a stack trace or a blank screen.
  const message = kiosk.getByRole("alert").first();
  await expect(message).toBeVisible({ timeout: 20_000 });
  await expect(message).not.toContainText(/TypeError|fetch|undefined|stack|Error:/i);
  await expect(kiosk.locator("body")).toContainText(/front desk/i);

  // The connection returns; the person starts again and is served normally.
  await kiosk.context().setOffline(false);
  await kiosk.goto("/");
  await expect(kiosk.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await identify(who);
  await kiosk.getByRole("button", { name: "Continue" }).click();
  await expect(kiosk.getByRole("heading", { name: "What are you here for?" })).toBeVisible();
  await kiosk.getByRole("button", { name: state.kioskVisitType.name }).click();
  await expect(kiosk.getByRole("heading", { name: "You are checked in" })).toBeVisible();
  expect(await queueEntries(await ticketOf())).toBe(1);
});
