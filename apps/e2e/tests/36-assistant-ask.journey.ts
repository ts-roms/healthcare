import { expect, type Locator, type Page, test } from "@playwright/test";
import { type StaffApi, staffApi } from "../support/api";
import { STAFF } from "../support/env";
import { staffPage, toast } from "../support/pages";

/**
 * The assistant's Ask (docs/domains/assistant.md, "Ask"; ADR-0019): an administrator opens **Assistant → Ask** and
 * types a question in their own words; the answer names the dates and facility it used, compares the month with the
 * one before, says how the figures are worked out and links to the dashboard that holds them, and the address names the
 * question, never the words. Saved, it stays under "Your questions". A question about a patient is not recognised and
 * nothing is kept. A receptionist, whose role cannot open the management dashboard, is told so plainly for a period
 * question and offered the questions they can ask. The audit trail holds what was asked, never what was typed.
 */
test.describe.configure({ mode: "serial" });

const errors: string[] = [];

/** The seeded clinic, which `staffPage` selects in the top bar (support/prepare-database.ts). */
const FACILITY = "E2E Main Clinic";
/** Typed as a person might: these words must reach neither the address nor the audit trail. */
const TYPED = "How many no-shows did we have this month vs last month?";
const ABOUT_A_PATIENT = "What is Juanita Placeholder's blood pressure?";
/** The question as kept: question, period and comparison only. */
const KEPT = "No-shows, This month, vs the period before";

let admin: Page;
let desk: Page;
/** The administrator's API session (sign-ins are rate limited). */
let api: StaffApi;

const nav = (page: Page): Locator => page.getByRole("navigation", { name: "Main" });
const box = (page: Page): Locator => page.getByRole("textbox", { name: "Your question" });
const askButton = (page: Page): Locator => page.getByRole("button", { name: "Ask", exact: true });
const yours = (page: Page): Locator => page.getByRole("region", { name: "Your questions" });
const offered = (page: Page): Locator => page.getByRole("region", { name: "Questions you can ask" });

interface History {
  saved: Array<{ id: string }>;
  recent: Array<{ id: string }>;
}

test.beforeAll(async ({ browser }) => {
  // The facility is read from the API (not the shared seed file), by name: other journeys add facilities.
  const bootstrap = await staffApi(STAFF.admin);
  const facility = (await bootstrap.get<Array<{ id: string; name: string }>>("/facilities")).find((f) => f.name === FACILITY);
  await bootstrap.dispose();
  if (!facility) throw new Error(`No facility named ${FACILITY}`);
  api = await staffApi(STAFF.admin, facility.id);
  // The administrator's own questions start empty (a retry, or another journey, may have asked before).
  const history = await api.get<History>("/assistant/ask/history");
  for (const entry of [...history.saved, ...history.recent]) await api.post(`/assistant/ask/history/${entry.id}/remove`);

  admin = await staffPage(browser, STAFF.admin, errors);
  desk = await staffPage(browser, STAFF.desk, errors);
});

test.afterAll(async () => {
  await api?.dispose();
  await admin?.context().close();
  await desk?.context().close();
});

test("an administrator asks in their own words from Assistant → Ask; the address names the question, never the words", async () => {
  await admin.goto("/");
  await nav(admin).getByRole("link", { name: "Ask", exact: true }).click();
  await admin.waitForURL(/\/assistant\/ask$/);
  await expect(admin.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
  await expect(yours(admin)).toContainText("never the words you typed");

  await box(admin).fill(TYPED);
  await askButton(admin).click();
  await admin.waitForURL(/question=clinic\.no-shows/);
  // The address holds the question, its period and comparison, and nothing else ("no-shows" itself contains "how").
  const url = new URL(admin.url());
  expect(Object.fromEntries(url.searchParams)).toEqual({ question: "clinic.no-shows", period: "this-month", compare: "previous" });
  expect(url.hash).toBe("");
  expect(decodeURIComponent(admin.url())).not.toMatch(/many|did we|have/i);

  // The answer repeats what it read: the question, its dates, the comparison and the facility.
  const answer = admin.getByRole("region", { name: "No-shows" });
  await expect(answer.getByText("From your own records")).toBeVisible();
  await expect(answer).toContainText(`This month · `);
  await expect(answer).toContainText(FACILITY);
  await expect(answer).toContainText("Compared with the period before · ");
  await expect(answer.getByRole("row", { name: "Figure This period Compared with Change" })).toBeVisible();
  await expect(answer.getByRole("row").filter({ hasText: "No-show rate" })).toBeVisible();
  await answer.getByText("How this was calculated").click();
  await expect(answer).toContainText("No-shows ÷ appointments booked");
  await expect(answer.getByRole("link", { name: "Open the management dashboard" })).toHaveAttribute("href", "/management");
  // The box starts afresh for the next question.
  await expect(box(admin)).toHaveValue("");
});

test("the question is kept under Your questions, saved, and asked again from there", async () => {
  await expect(yours(admin).getByRole("link", { name: KEPT })).toBeVisible();
  // Save sits beside Ask, for the answer on screen.
  await admin.getByRole("button", { name: "Save this question" }).click();
  await toast(admin, "Question saved.");
  await expect(admin.getByRole("button", { name: "Saved: stop saving this question" })).toBeVisible();
  await expect(yours(admin).getByRole("region", { name: "Saved" }).getByRole("link", { name: KEPT })).toBeVisible();

  // Kept by the API, not the browser: a new visit lists it, and its link asks it again.
  await admin.goto("/assistant/ask");
  await yours(admin).getByRole("region", { name: "Saved" }).getByRole("link", { name: KEPT }).click();
  await admin.waitForURL(/question=clinic\.no-shows&period=this-month&compare=previous$/);
  await expect(admin.getByRole("region", { name: "No-shows" })).toContainText("Compared with the period before");
  await expect(admin.getByRole("button", { name: "Saved: stop saving this question" })).toBeVisible();
});

test("a question about a patient is not recognised: nothing is answered or kept, and the words stay in the box", async () => {
  // New question leaves the answer on screen for an empty conversation.
  await yours(admin).getByRole("link", { name: "New question" }).click();
  await admin.waitForURL(/\/assistant\/ask$/);
  await expect(admin.getByRole("region", { name: "No-shows" })).toHaveCount(0);
  await expect(admin.getByRole("button", { name: "Save this question" })).toBeDisabled();
  await box(admin).fill(ABOUT_A_PATIENT);
  await askButton(admin).click();
  await expect(admin.getByText("I did not recognise that question.")).toBeVisible();
  await expect(admin.getByText("It does not look up patients")).toBeVisible();
  await expect(box(admin)).toHaveValue(ABOUT_A_PATIENT);
  expect(new URL(admin.url()).search).toBe("");
  await expect(yours(admin)).not.toContainText("Placeholder");
});

test("an example opens its answer directly: what is running low at the facility", async () => {
  await offered(admin).getByRole("link", { name: "What is running low?" }).click();
  await admin.waitForURL(/\/assistant\/ask\?question=inventory\.low$/);
  const answer = admin.getByRole("region", { name: "Low stock" });
  await expect(answer).toContainText(FACILITY);
  await expect(answer).not.toContainText("Compared with");
  await expect(answer.getByRole("link", { name: "Open low stock" })).toBeVisible();
  await expect(yours(admin).getByRole("region", { name: "Recent" }).getByRole("link", { name: "Low stock" })).toBeVisible();
});

test("a receptionist is told plainly when a question reads figures their role cannot open, and offered what they can ask", async () => {
  await desk.goto("/assistant/ask");
  await expect(offered(desk).getByRole("link", { name: "Who is waiting now?" })).toBeVisible();
  await expect(offered(desk).getByRole("link", { name: "Revenue this month vs last month" })).toHaveCount(0);
  await expect(offered(desk)).toContainText(/more questions read figures your role cannot open, so they are not offered/);

  await box(desk).fill("Revenue this month");
  await askButton(desk).click();
  await desk.waitForURL(/question=billing\.revenue&period=this-month$/);
  const withheld = desk.getByRole("region", { name: "Revenue and collections" });
  await expect(withheld).toContainText("This answer comes from figures your role cannot open (the management dashboard), so it is not shown.");
  await expect(withheld.getByRole("table")).toHaveCount(0);
  await expect(withheld.getByText("From your own records")).toHaveCount(0);
  // Not kept, so there is nothing to save.
  await expect(desk.getByRole("button", { name: "Save this question" })).toBeDisabled();
  // Not answered, so not kept.
  await expect(yours(desk)).not.toContainText("Revenue");

  // What they can open is answered.
  await offered(desk).getByRole("link", { name: "Who is waiting now?" }).click();
  await desk.waitForURL(/question=clinic\.waiting-now$/);
  await expect(desk.getByRole("region", { name: "Who is waiting" })).toContainText(`at ${FACILITY} now`);
});

test("the audit trail records each question asked and its outcome, never the words typed", async () => {
  const page = await api.get<{ items: Array<{ action: string; outcome: string; metadata: Record<string, unknown> }> }>(
    "/audit-events?action=assistant.ask&pageSize=100",
  );
  const asked = page.items.map((e) => e.metadata);
  expect(asked).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ questionId: "clinic.no-shows", period: "this-month", compare: "previous", scope: "facility", result: "answered" }),
      expect.objectContaining({ questionId: "billing.revenue", result: "withheld" }),
      expect.objectContaining({ questionId: "inventory.low", result: "answered" }),
    ]),
  );
  // A withheld answer is not a refusal: the record-access check counts refusals per account.
  expect(page.items.every((e) => e.outcome === "success")).toBe(true);
  const recorded = JSON.stringify(page.items);
  expect(recorded).not.toContain("Placeholder");
  expect(recorded).not.toMatch(/how many|did we have|blood pressure/i);
});

test("Ask is also a chat at the bottom-right of every page; help moves to the top bar", async () => {
  await admin.goto("/");
  // Help stays one click away, in the top bar.
  await expect(admin.getByRole("button", { name: "Open the user manual" })).toBeVisible();
  await admin.getByRole("button", { name: "Ask a question" }).click();
  const chat = admin.getByRole("dialog", { name: "Ask" });
  await expect(chat.getByRole("list", { name: "Questions you can ask" }).getByRole("button", { name: "No-shows last week" })).toBeVisible();

  await chat.getByRole("textbox", { name: "Question for Ask" }).fill("No-shows last week");
  await chat.getByRole("button", { name: "Send" }).click();
  // The question shows as the person's message, the answer as on the Ask page; the address does not change.
  await expect(chat.getByRole("log")).toContainText("No-shows last week");
  const answer = chat.getByRole("region", { name: "No-shows" });
  await expect(answer).toContainText("Last week · ");
  await expect(answer).toContainText(FACILITY);
  expect(new URL(admin.url()).pathname).toBe("/");

  // An answer's link opens its screen and closes the chat; the conversation is still there when it opens again.
  await answer.getByRole("link", { name: "Open the management dashboard" }).click();
  await admin.waitForURL(/\/management$/);
  await expect(chat).toHaveCount(0);
  await admin.getByRole("button", { name: "Ask a question" }).click();
  await expect(admin.getByRole("dialog", { name: "Ask" }).getByRole("region", { name: "No-shows" })).toBeVisible();
  await admin.keyboard.press("Escape");
  await expect(admin.getByRole("dialog", { name: "Ask" })).toHaveCount(0);

  // The arrows make the chat larger, and smaller again.
  await admin.getByRole("button", { name: "Ask a question" }).click();
  const reopened = admin.getByRole("dialog", { name: "Ask" });
  const width = async () => (await reopened.boundingBox())?.width ?? 0;
  const narrow = await width();
  await reopened.getByRole("button", { name: "Make the chat larger" }).click();
  await expect.poll(width).toBeGreaterThan(narrow + 200);
  await reopened.getByRole("button", { name: "Make the chat smaller" }).click();
  await expect.poll(width).toBeLessThan(narrow + 50);
  // The link at its foot opens the whole Ask page, where the chat button steps aside.
  await reopened.getByRole("link", { name: "Open the Ask page" }).click();
  await admin.waitForURL(/\/assistant\/ask$/);
  await expect(admin.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Ask a question" })).toHaveCount(0);
});

test("clearing recent questions keeps the saved one, and nothing broke along the way", async () => {
  await admin.goto("/assistant/ask");
  await yours(admin).getByRole("button", { name: "Clear recent" }).click();
  await toast(admin, "Recent questions cleared.");
  await expect(yours(admin).getByRole("region", { name: "Recent" })).toHaveCount(0);
  await expect(yours(admin).getByRole("region", { name: "Saved" }).getByRole("link", { name: KEPT })).toBeVisible();
  expect(errors).toEqual([]);
});
