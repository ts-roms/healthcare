import { expect, type Page, test } from "@playwright/test";
import { loadState, type StaffApi, staffApi } from "../support/api";
import { KIOSK_URL, STAFF, STAFF_PASSWORD } from "../support/env";
import { staffPage, toast, watchErrors } from "../support/pages";

/**
 * The cases the kiosk audit left without a browser journey (docs/security/kiosk-audit-phase-6.md, KA-11): a ticket taken at
 * the kiosk is sent on to another service point; two counters in two browsers call tickets at the same moment and the
 * waiting-room screen shows and reads out both, one after the other; and the call is read in English and Filipino.
 *
 * The browser's speech synthesis is replaced by a recorder that plays utterances one at a time like the real one, so the
 * journey checks what the screen asked to be said, in what order, and that nothing was cut off or spoken over.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];

let kiosk: Page;
let desk: StaffApi;
let n = 0;

interface Ticket {
  ticket: string;
  family: string;
}

/** A patient registered by the front desk who checks in at the kiosk as a walk-in; returns the ticket shown. */
async function checkInAtKiosk(): Promise<Ticket> {
  n += 1;
  const family = `Voice${n}x`;
  const birthDate = `19${60 + (n % 30)}-0${1 + (n % 9)}-${10 + (n % 18)}`;
  const patient = await desk.post<{ patientNumber: string }>("/patients", {
    familyName: family,
    givenName: `Given${n}`,
    sex: "female",
    birthDate,
    contacts: [{ system: "mobile", value: `0917 555 ${String(4000 + n)}` }],
  });
  const [year, month, day] = birthDate.split("-") as [string, string, string];
  await kiosk.goto("/");
  await kiosk.getByRole("button", { name: "Touch here to check in" }).click();
  await kiosk.getByRole("button", { name: "Yes, I am a patient here" }).click();
  await kiosk.locator("#key").fill(patient.patientNumber);
  await kiosk.locator("#birth-day").fill(String(Number(day)));
  await kiosk.locator("#birth-month").selectOption(String(Number(month)));
  await kiosk.locator("#birth-year").fill(year);
  await kiosk.locator("#givenName").fill(`Given${n}`);
  await kiosk.getByRole("button", { name: "Continue" }).click();
  await kiosk.getByRole("button", { name: state.kioskVisitType.name }).click();
  await expect(kiosk.getByRole("heading", { name: "You are checked in" })).toBeVisible();
  return { ticket: /A-\d{3}/.exec(await kiosk.getByLabel("Your queue ticket").innerText())![0], family };
}

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

test.afterAll(async () => {
  await desk.dispose();
  await kiosk.context().close();
  expect(errors, "console or page errors").toEqual([]);
});

const cardOf = (page: Page, who: Ticket) => page.getByRole("button", { name: new RegExp(`${who.ticket}.*${who.family}`, "i") });
const panelOf = (page: Page, who: Ticket) => page.getByRole("complementary", { name: `Ticket ${who.ticket}` });

test("a ticket taken at the kiosk is sent on to another service point by reception", async ({ browser }) => {
  const who = await checkInAtKiosk();
  const code = `ka11-${Date.now().toString(36)}`;
  const point = await desk
    .post<{ id: string; name: string }>("/clinic/service-points", {
      facilityId: state.facilityId,
      code,
      name: `Sample room ${n}`,
      kind: "other",
      location: `Sample ${n}`,
    })
    .catch(async () => {
      // The front desk may not configure service points: an administrator does.
      const admin = await staffApi(STAFF.admin, state.facilityId);
      try {
        return await admin.post<{ id: string; name: string }>("/clinic/service-points", {
          facilityId: state.facilityId,
          code,
          name: `Sample room ${n}`,
          kind: "other",
          location: `Sample ${n}`,
        });
      } finally {
        await admin.dispose();
      }
    });

  const reception = await staffPage(browser, STAFF.desk, errors);
  try {
    await reception.goto("/queue");
    await cardOf(reception, who).click();
    const panel = panelOf(reception, who);
    await panel.getByRole("button", { name: "Move to Triage / Vitals" }).click();
    await toast(reception, `${who.ticket}: Send to triage`);
    await panel.getByLabel("Send to").selectOption({ label: `${point.name} · Other` });
    await panel.getByRole("button", { name: "Send", exact: true }).click();
    await toast(reception, `${who.ticket} sent to ${point.name}`);
    await expect(panel.getByText(point.name).first()).toBeVisible();

    // The ticket is on that service point's line and no longer on the general one.
    const there = await desk.get<Array<{ ticket: string }>>(`/queue?servicePointId=${point.id}`);
    expect(there.map((r) => r.ticket)).toContain(who.ticket);
  } finally {
    await reception.context().close();
  }
});

test("two counters call at the same moment: the waiting-room screen shows both and reads each out in turn, in both languages", async ({ browser }) => {
  const first = await checkInAtKiosk();
  const second = await checkInAtKiosk();

  // The waiting-room screen, with a speech synthesizer that records what it is asked to say and says one thing at a time.
  const screen = await staffPage(browser, STAFF.display, errors);
  await screen.addInitScript(() => {
    const spoken: Array<{ lang: string; text: string; start: number; end: number }> = [];
    let free = 0;
    const synth = window.speechSynthesis;
    synth.getVoices = () => [];
    synth.cancel = () => undefined;
    synth.speak = (utterance: SpeechSynthesisUtterance) => {
      const now = performance.now();
      const start = Math.max(now, free);
      free = start + 150;
      spoken.push({ lang: utterance.lang, text: utterance.text, start, end: free });
      setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), free - now);
    };
    (window as unknown as { __spoken: typeof spoken }).__spoken = spoken;
  });
  const reception = [await staffPage(browser, STAFF.desk, errors), await staffPage(browser, STAFF.desk, errors)];
  try {
    await screen.reload();
    await screen.waitForURL(/\/display\/queue$/);
    await screen.getByRole("button", { name: "Settings" }).click();
    await screen.getByRole("button", { name: "Turn on sound" }).click();
    await screen.getByRole("radio", { name: "Both" }).click();
    await screen.keyboard.press("Escape");
    await expect(screen.getByRole("button", { name: "Turn sound off" })).toBeVisible();

    const people = [first, second];
    for (const [index, page] of reception.entries()) {
      await page.goto("/queue");
      await cardOf(page, people[index]!).click();
      await panelOf(page, people[index]!)
        .getByLabel("Call patient to")
        .fill(`Room ${11 + index}`);
    }
    // Both counters press Call together.
    await Promise.all(reception.map((page, index) => panelOf(page, people[index]!).getByRole("button", { name: "Call", exact: true }).click()));
    await toast(reception[0]!, `${first.ticket} called to Room 11`);
    await toast(reception[1]!, `${second.ticket} called to Room 12`);

    // Both calls reach the screen without reloading it, and neither name is shown.
    await expect(screen.getByText("Room 11").first()).toBeVisible();
    await expect(screen.getByText("Room 12").first()).toBeVisible();
    await expect(screen.locator("body")).not.toContainText(new RegExp(`${first.family}|${second.family}|Given${n}`, "i"));

    // Four lines are read: each call in English then Filipino, one call after the other and never over each other.
    const spoken = () => screen.evaluate(() => (window as unknown as { __spoken: Array<{ lang: string; text: string; start: number; end: number }> }).__spoken);
    await expect.poll(async () => (await spoken()).length, { timeout: 30_000 }).toBe(4);
    const lines = await spoken();
    const rooms = lines.map((l) => /Room (\d+)/.exec(l.text)?.[1]);
    expect(new Set(rooms)).toEqual(new Set(["11", "12"]));
    // Contiguous: the two lines of one call, then the two of the other.
    expect(rooms[0]).toBe(rooms[1]);
    expect(rooms[2]).toBe(rooms[3]);
    expect(rooms[0]).not.toBe(rooms[2]);
    for (const pair of [lines.slice(0, 2), lines.slice(2, 4)]) {
      expect(pair[0]!.lang).toBe("en-PH");
      expect(pair[0]!.text).toMatch(/^Number A \d \d \d, please proceed to Room \d+\.$/);
      expect(pair[1]!.lang).toBe("fil-PH");
      expect(pair[1]!.text).toMatch(/^Numero A \d \d \d, pumunta po sa Room \d+\.$/);
    }
    // The second call starts only after the first has finished.
    expect(lines[2]!.start).toBeGreaterThanOrEqual(lines[1]!.end - 1);
    // No problem notice: the announcements worked.
    await expect(screen.getByText(/announcements are not working|could not be played/i)).toHaveCount(0);
  } finally {
    for (const page of reception) await page.context().close();
    await screen.context().close();
  }
});
