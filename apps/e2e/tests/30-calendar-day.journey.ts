import { expect, type Page, test } from "@playwright/test";
import { loadState, type StaffApi, staffApi } from "../support/api";
import { STAFF } from "../support/env";
import { staffPage } from "../support/pages";

/**
 * The calendar's Day view: the hours of the day with each entry drawn where it falls, overlapping entries side by side, a
 * summary of the day, what is next, and the selected entry in full. Everything is booked for tomorrow (Asia/Manila) so the
 * journey gives the same picture whatever time of day it runs.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];
const ZONE = "Asia/Manila";

const dayOffset = (days: number): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now() + days * 86_400_000);
  return parts; // YYYY-MM-DD
};
const TOMORROW = dayOffset(1);
/** The entry on the hours: its name starts with its time ("9:00 am – 10:00 am, Title"), which tells it from the "Up next" list. */
const onHours = (page: Page, title: string) => page.getByRole("button", { name: new RegExp("^[0-9]+:[0-9][0-9].*, " + title, "i") });
const at = (hhmm: string, day = TOMORROW) => new Date(`${day}T${hhmm}:00+08:00`).toISOString();

let admin: StaffApi;
let page: Page;
const shots = process.env.E2E_CALENDAR_SHOTS;

const PEOPLE = [
  { family: "Aranda", given: "Beatriz", birthDate: "1985-03-04" },
  { family: "Bautista", given: "Carlo", birthDate: "1972-09-21" },
  { family: "Cordero", given: "Dolores", birthDate: "1991-12-02" },
  { family: "Dimaculangan", given: "Emilio", birthDate: "1964-06-15" },
];

async function person(index: number) {
  const who = PEOPLE[index]!;
  const created = await admin.post<{ id: string }>("/patients", {
    familyName: who.family,
    givenName: who.given,
    sex: "female",
    birthDate: who.birthDate,
    contacts: [{ system: "mobile", value: `0917 555 ${String(4100 + index)}` }],
  });
  return created.id;
}

/** Books an appointment, moving it a few minutes later when the doctor is already booked then (another journey, or an earlier run). */
async function book(patientId: string, practitionerId: string, hhmm: string, reason: string) {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  for (let shift = 0; shift < 6; shift += 1) {
    const total = h * 60 + m + shift * 7;
    const time = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    try {
      await admin.post("/appointments", {
        patientId,
        practitionerId,
        facilityId: state.facilityId,
        visitTypeId: state.consultVisitTypeId,
        startsAt: at(time),
        outsideSchedule: true,
        reason,
      });
      return;
    } catch (error) {
      if (!String((error as Error).message).includes("slot_unavailable")) throw error;
    }
  }
  throw new Error(`No free time near ${hhmm} for the doctor`);
}

test.beforeAll(async ({ browser }) => {
  admin = await staffApi(STAFF.admin, state.facilityId);
  const [a, b, c, d] = await Promise.all([person(0), person(1), person(2), person(3)]);
  await book(a, state.practitionerId, "09:00", "Blood pressure follow-up");
  await book(b, state.telePractitionerId, "09:10", "Cough for two weeks");
  await book(c, state.practitionerId, "11:00", "Wound dressing");
  await book(d, state.practitionerId, "14:00", "Annual check-up");
  const event = (title: string, kind: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
    admin.post("/calendar/events", {
      facilityId: state.facilityId,
      title,
      kind,
      startsAt: at(from),
      endsAt: at(to),
      allDay: false,
      visibility: "facility",
      ...extra,
    });
  await event("Staff huddle", "meeting", "08:00", "08:30", { location: "Staff room" });
  await event("Infection control training", "training", "13:00", "15:30", {
    location: "Conference room",
    description: "Annual refresher for all clinical staff.",
  });
  await admin.post("/calendar/events", {
    facilityId: state.facilityId,
    title: "Clinic anniversary",
    kind: "event",
    startsAt: at("00:00"),
    endsAt: at("00:00", dayOffset(3)),
    allDay: true,
    visibility: "facility",
  });
  page = await staffPage(browser, STAFF.admin, errors);
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test.afterAll(async () => {
  await admin.dispose();
  await page?.context().close();
  expect(errors, "console or page errors").toEqual([]);
});

test("the day is laid out by the hour: each entry where it falls, overlapping entries side by side", async () => {
  await page.goto(`/calendar?view=day&date=${TOMORROW}`);
  await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible();
  await expect(page.getByText(/\d+ entries/)).toBeVisible();
  // The all-day event is above the hours, not on them.
  await expect(page.getByRole("button", { name: /All day · Clinic anniversary/ })).toBeVisible();

  await expect(onHours(page, "Staff huddle")).toBeVisible();

  // Entries that overlap in time share the width instead of covering each other.
  const boxOf = async (title: string) => (await onHours(page, title).boundingBox())!;
  const covers = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
  const [aranda, bautista] = [await boxOf("Aranda"), await boxOf("Bautista")];
  expect(covers(aranda, bautista), "the two morning appointments overlap in time and must not cover each other").toBe(false);
  expect(aranda.y).toBeLessThan(bautista.y + bautista.height); // and they do overlap vertically, side by side
  const [training, dimaculangan] = [await boxOf("Infection control training"), await boxOf("Dimaculangan")];
  expect(covers(training, dimaculangan), "the training and the afternoon appointment must not cover each other").toBe(false);
  // Later in the day sits lower on the page.
  expect(dimaculangan.y).toBeGreaterThan(aranda.y);

  if (shots) await page.screenshot({ path: `${shots}/day-view.png`, fullPage: true });
});

test("the day's figures and what is next are shown beside the hours", async () => {
  await expect(page.getByRole("heading", { name: "Day total" })).toBeVisible();
  await expect(page.getByText("Appointments", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Events", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /First of the day|Up next/ })).toBeVisible();
  // The mini month marks the day shown.
  await expect(page.locator("[aria-current=date]")).toHaveText(String(Number(TOMORROW.slice(8))));
});

test("selecting an entry shows it in full: an event with its notes and actions, an appointment with its reason", async () => {
  await onHours(page, "Infection control training").click();
  const panel = page.locator("[aria-live=polite]").filter({ hasText: "Infection control training" });
  await expect(panel.getByText("Annual refresher for all clinical staff.")).toBeVisible();
  await expect(panel.getByText("Conference room")).toBeVisible();
  await expect(panel.getByText("2 h 30 min")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Edit event" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Cancel event…" })).toBeVisible();

  await page
    .getByRole("button", { name: /^2:\d\d.*(?:pm|PM)/ })
    .first()
    .click();
  const appointment = page.locator("[aria-live=polite]").filter({ hasText: "Annual check-up" });
  await expect(appointment.getByRole("heading", { name: /Dimaculangan/i })).toBeVisible();
  await expect(appointment.getByText("Booked", { exact: true })).toBeVisible();
  await expect(appointment.getByRole("link", { name: "Open in appointments" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/day-view-detail.png`, fullPage: true });
});

test("a day can be reached from the mini month, an event edited from the panel, and the day laid out by room", async () => {
  await onHours(page, "Infection control training").click();
  await page.getByRole("button", { name: "Edit event" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Lay the day out by room").click();
  await expect(page.getByText("Events and no room").first()).toBeVisible();
  await page.getByLabel("Lay the day out by room").click();

  const next = dayOffset(2);
  await page.getByRole("link", { name: `Open ${next}` }).click();
  await page.waitForURL(new RegExp(`date=${next}`));
  // The all-day event covers this day as well.
  await expect(page.getByRole("button", { name: /All day · Clinic anniversary/ })).toBeVisible();
});

test("the day view fits a narrow window without sideways scrolling, with the three parts stacked", async () => {
  for (const width of [1024, 820, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/calendar?view=day&date=${TOMORROW}`);
    await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `sideways overflow at ${width}px`).toBeLessThanOrEqual(1);
    await expect(page.getByRole("heading", { name: "Day total" })).toBeVisible();
  }
  if (shots) await page.screenshot({ path: `${shots}/day-view-narrow.png`, fullPage: true });
});
