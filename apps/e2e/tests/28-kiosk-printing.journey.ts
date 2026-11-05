import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { loadState, type StaffApi, staffApi } from "../support/api";
import { API_URL, KIOSK_URL, STAFF, STAFF_PASSWORD } from "../support/env";
import { staffPage, toast, watchErrors } from "../support/pages";

/**
 * Kiosk ticket printing and the waiting-room screen's extras, with the real print agent (tools/kiosk-print-agent) running as
 * its own process against the real API. The agent prints to a folder (dry run), or to a printer path that does not exist, so no
 * printer is needed; what this proves is the path from a kiosk check-in to a printed ticket and what staff and the patient see
 * when the printer fails. It does not prove anything about a real printer, kiosk or TV: that is checked on the target devices.
 */
test.describe.configure({ mode: "serial" });

const state = loadState();
const errors: string[] = [];
const REPO_ROOT = resolve(__dirname, "../../..");
const HEALTH_PORT = Number(process.env.E2E_AGENT_PORT ?? 8799);

let desk: StaffApi;
let kiosk: Page;
let n = 0;
const agents: ChildProcess[] = [];

const healthUrl = () => `http://127.0.0.1:${HEALTH_PORT}/health`;
const answersHealth = () =>
  fetch(healthUrl()).then(
    () => true,
    () => false,
  );

/** Waits until nothing answers on the agent's health port, so a health answer can only come from the agent started next. */
async function waitForPortFree() {
  for (let i = 0; i < 40; i++) {
    if (!(await answersHealth())) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("An earlier print agent is still answering on the health port");
}

/**
 * Waits until the agent has signed in and asked for tickets once (its health report then has a poll time). The API turns away
 * more than about ten sign-ins a minute from one address, and a full run reaches that; an agent refused at start-up waits out
 * the API's Retry-After (up to a minute) before it signs in, so a ticket checked in meanwhile would otherwise look unprinted.
 */
async function waitUntilSignedIn(child: ChildProcess) {
  for (let i = 0; i < 180; i++) {
    if (child.exitCode !== null) throw new Error(`The print agent exited at start-up (code ${child.exitCode})`);
    try {
      const health = (await (await fetch(healthUrl())).json()) as { lastPollAt?: string | null };
      if (health.lastPollAt) return;
    } catch {
      // not answering yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The print agent never signed in (the API may be refusing its sign-in)");
}

/** Starts the print agent; resolves when its health check answers. `printer` is where it prints. */
async function startAgent(printer: { dryRunDir: string } | { path: string }): Promise<ChildProcess> {
  // The agent before this one must be gone: it uses the same health port, and its answer must not pass for this agent's.
  await waitForPortFree();
  const env = {
    ...process.env,
    API_BASE_URL: API_URL,
    AGENT_EMAIL: STAFF.agent,
    AGENT_PASSWORD: STAFF_PASSWORD,
    FACILITY_ID: state.facilityId,
    DEVICE_CODES: state.kioskDeviceCode,
    POLL_MS: "1000",
    HEARTBEAT_MS: "5000",
    HEALTH_PORT: String(HEALTH_PORT),
    ...("dryRunDir" in printer ? { PRINTER_TYPE: "dryrun", DRYRUN_DIR: printer.dryRunDir } : { PRINTER_TYPE: "file", PRINTER_PATH: printer.path }),
  };
  const child = spawn(process.execPath, ["-r", "@swc-node/register", "tools/kiosk-print-agent/src/main.ts"], { cwd: REPO_ROOT, env, stdio: "ignore" });
  agents.push(child);
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`The print agent exited at start-up (code ${child.exitCode})`);
    if (await answersHealth()) {
      await waitUntilSignedIn(child);
      return child;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The print agent did not start");
}

/** Stops the agent and waits until it has really exited, so its port and its sign-in are gone before the next one starts. */
async function stopAgent(child: ChildProcess) {
  if (child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  }
  await waitForPortFree();
}

/** An existing patient checks in at the kiosk as a walk-in; returns the ticket shown. */
async function checkInAtKiosk(): Promise<string> {
  n += 1;
  const birthDate = `19${60 + (n % 30)}-0${1 + (n % 9)}-${10 + (n % 18)}`;
  // Registered by the front desk's session opened once for the file: a sign-in per check-in would use the API's sign-in allowance
  // (ten a minute for all journeys) and make this journey wait out the window.
  const patient = await desk.post<{ patientNumber: string }>("/patients", {
    familyName: `Printing${n}x`,
    givenName: `Given${n}`,
    sex: "female",
    birthDate,
    contacts: [{ system: "mobile", value: `0917 555 ${String(2000 + n)}` }],
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
  return /A-\d{3}/.exec(await kiosk.getByLabel("Your queue ticket").innerText())![0];
}

const devices = async () => (await desk.get<{ items: Array<{ code: string; printer: string; printerStatus: string }> }>("/kiosk/admin/devices")).items;
/** The text of every ticket printed into the folder so far (older tickets still waiting from earlier journeys are printed too, oldest first). */
const printedTexts = async (dir: string) => Promise.all((await ticketFiles(dir)).map((f) => readFile(join(dir, f), "utf8")));
const ticketFiles = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".txt")).sort();

test.beforeAll(async ({ browser }) => {
  desk = await staffApi(STAFF.desk, state.facilityId);
  const context = await browser.newContext({ baseURL: KIOSK_URL, viewport: { width: 1080, height: 1920 }, hasTouch: true });
  kiosk = await context.newPage();
  watchErrors(kiosk, "kiosk", errors);
  // The API allows about ten sign-ins a minute; the journey before this one may have used them: wait out the window once.
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
  for (const child of agents) child.kill();
  await desk.dispose();
  await kiosk.context().close();
  expect(errors, "console or page errors").toEqual([]);
});

/**
 * Waits until the ticket has been printed into the folder. An agent that starts while the API is turning sign-ins away waits
 * out the API's Retry-After before it signs in (up to a minute), so this allows for that; if it still does not print, the
 * agent's own health report is added to the failure so the cause is visible.
 */
async function expectPrinted(dir: string, ticket: string) {
  try {
    await expect.poll(async () => (await printedTexts(dir)).some((t) => t.includes(ticket)), { timeout: 75_000 }).toBe(true);
  } catch (error) {
    const health = await fetch(healthUrl()).then(
      (r) => r.text(),
      () => "no answer from the agent's health port",
    );
    throw new Error(`${(error as Error).message}
Agent health: ${health}`);
  }
}

test("a check-in prints the ticket through the print agent, and the kiosk tells the person so", async () => {
  test.setTimeout(180_000);
  const dir = await mkdtemp(join(tmpdir(), "e2e-printed-"));
  const agent = await startAgent({ dryRunDir: dir });
  try {
    const ticket = await checkInAtKiosk();
    await expect(kiosk.getByRole("status").filter({ hasText: "Your ticket is printed" })).toBeVisible({ timeout: 20_000 });

    // The printed ticket carries the number and the service — and nothing about the patient.
    await expectPrinted(dir, ticket);
    const printed = (await printedTexts(dir)).find((t) => t.includes(ticket))!;
    expect(printed).toContain(state.kioskVisitType.name);
    expect(printed).not.toMatch(/Printing\d+x|Given\d+/);

    // The agent's health check answers on this machine, and the printer shows as working to staff.
    const health = await (await fetch(`http://127.0.0.1:${HEALTH_PORT}/health`)).json();
    expect(health).toMatchObject({ status: "ok", printer: "ok" });
    await expect.poll(async () => (await devices()).find((d) => d.code === state.kioskDeviceCode)?.printer, { timeout: 20_000 }).toBe("available");
  } finally {
    await stopAgent(agent);
  }
});

test("a printer that cannot print: the kiosk sends the person to the desk, staff see it, and printing again works once it is fixed", async ({ browser }) => {
  test.setTimeout(240_000);
  // A printer path that does not exist: every attempt fails.
  const broken = await startAgent({ path: join(tmpdir(), "e2e-no-such-folder", "lp0") });
  let ticket: string;
  try {
    ticket = await checkInAtKiosk();
    await expect(kiosk.getByRole("status").filter({ hasText: "We could not print your ticket" })).toBeVisible({ timeout: 30_000 });
    // The number is still on screen: a printer problem never stops a check-in.
    await expect(kiosk.getByLabel("Your queue ticket")).toContainText(ticket);

    await expect.poll(async () => (await devices()).find((d) => d.code === state.kioskDeviceCode)?.printer, { timeout: 20_000 }).toBe("attention");
  } finally {
    await stopAgent(broken);
  }

  const reception = await staffPage(browser, STAFF.desk, errors);
  const dir = await mkdtemp(join(tmpdir(), "e2e-recovered-"));
  const fixed = await startAgent({ dryRunDir: dir });
  try {
    await reception.goto("/queue/devices");
    await expect(reception.getByText("Printer needs attention").or(reception.getByText("Printer working"))).toBeVisible();
    const row = reception.getByRole("row", { name: new RegExp(ticket) });
    await expect(row.getByText("Failed")).toBeVisible();

    // Staff print it again, with a reason; the repaired printer prints it.
    await row.getByRole("button", { name: `Print ticket ${ticket} again` }).click();
    await reception.getByLabel(new RegExp(`Print ${ticket} again`)).fill("Printer was out of paper");
    await reception.getByRole("button", { name: "Print again", exact: true }).click();
    await toast(reception, new RegExp(`${ticket} will print again`));
    await expectPrinted(dir, ticket);

    // The reprint is listed, and the printer is working again.
    await reception.goto("/queue/devices");
    await expect(reception.getByText("printed again").first()).toBeVisible();
    await expect.poll(async () => (await devices()).find((d) => d.code === state.kioskDeviceCode)?.printer, { timeout: 20_000 }).toBe("available");
  } finally {
    await stopAgent(fixed);
    await reception.context().close();
  }
});

test("the waiting-room screen is a monitored device, and says what the clinic told it to, grouped by department", async ({ browser }) => {
  // The clinic's own words, colour and grouping, set in the staff app.
  const admin = await staffPage(browser, STAFF.admin, errors);
  try {
    await admin.goto("/admin/service-points");
    await admin.locator("#display-headline").fill("Welcome to E2E Health");
    await admin.locator("#display-footer").fill("Keep your number until you are called.");
    // A colour that would be hard to read is refused before it can be saved.
    await admin.locator("#display-colour").fill("#FFEE00");
    await expect(admin.getByText(/hard to read from across a room/)).toBeVisible();
    await expect(admin.getByRole("button", { name: "Save display settings" })).toBeDisabled();
    await admin.locator("#display-colour").fill("#1A7F8E");
    await admin.getByRole("checkbox", { name: "Show calls by department" }).check();
    await admin.getByRole("button", { name: "Save display settings" }).click();
    await toast(admin, "Display settings saved");
  } finally {
    await admin.context().close();
  }

  const screen = await staffPage(browser, STAFF.display, errors);
  try {
    await screen.waitForURL(/\/display\/queue$/);
    await expect(screen.getByText("Welcome to E2E Health")).toBeVisible();
    await expect(screen.getByText("Keep your number until you are called.")).toBeVisible();
    await expect(screen.getByRole("heading", { name: "By department" })).toBeVisible();
    // The screen reports that it is alive.
    await expect
      .poll(
        async () =>
          (await desk.get<{ items: Array<{ code: string; health: string }> }>("/kiosk/admin/devices")).items.find((d) => d.code === "e2e-lobby-tv")?.health,
        {
          timeout: 30_000,
        },
      )
      .toBe("online");

    const reception = await staffPage(browser, STAFF.desk, errors);
    try {
      await reception.goto("/queue/devices");
      const row = reception.getByRole("row", { name: /E2E lobby screen/ });
      await expect(row.getByText("Waiting-room screen")).toBeVisible();
      await expect(row.getByText("Online")).toBeVisible();
    } finally {
      await reception.context().close();
    }
  } finally {
    await screen.context().close();
  }
});
