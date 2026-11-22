import type { AskPeriodKind } from "@healthcare/core";

/**
 * The questions the assistant's Ask answers (docs/domains/assistant.md, "Ask"; ADR-0019): a closed list, each answered
 * from the public method of the route that already shows its figures, with that route's permissions (`requires`, checked
 * against the route by the integration suite) and its own audit. Nothing here is about one patient: counts, amounts and
 * item names only. Raise `version` when what a question answers changes.
 */
export interface AskQuestionDefinition {
  id: string;
  version: number;
  title: string;
  /** Asked as written, they read as this question (the chips; a unit test holds every one to it). */
  examples: string[];
  /** Word groups that must all be found (synonyms per group; a synonym may be several words). */
  words: string[][];
  /** Word groups that make this question the better fit. */
  hints?: string[][];
  period: AskPeriodKind;
  /** The period when none is named (day and period questions). */
  defaultPeriod?: string;
  comparable: boolean;
  /** Can be answered for every facility the person's dashboard access covers. */
  organization: boolean;
  /** The permissions of the route whose figures it reads (all of them). */
  requires: string[];
  /** That route, for the parity check: method and path under /api/v1. */
  source: string;
  /** Where the full figures are. */
  link: { label: string; href: string };
}

const DASHBOARD = "GET /management/dashboard";
const DASHBOARD_LINK = { label: "Open the management dashboard", href: "/management" };

export const ASK_QUESTIONS: readonly AskQuestionDefinition[] = [
  {
    id: "clinic.no-shows",
    version: 1,
    title: "No-shows",
    examples: ["No-shows last week", "No-shows this month vs last month"],
    words: [["no show", "noshow", "missed appointment", "did not come", "did not show"]],
    hints: [["missed", "no show"]],
    period: "range",
    defaultPeriod: "last-30-days",
    comparable: true,
    organization: true,
    requires: ["management.dashboard.read"],
    source: DASHBOARD,
    link: DASHBOARD_LINK,
  },
  {
    id: "clinic.patients-seen",
    version: 1,
    title: "Patients seen",
    examples: ["Patients seen last week", "How many patients did we see this month?"],
    words: [["patient"], ["seen", "see", "saw", "consulted", "treated", "attended"]],
    period: "range",
    defaultPeriod: "last-30-days",
    comparable: true,
    organization: true,
    requires: ["management.dashboard.read"],
    source: DASHBOARD,
    link: DASHBOARD_LINK,
  },
  {
    id: "clinic.wait-time",
    version: 1,
    title: "Waiting time",
    examples: ["Average waiting time last week", "How long did patients wait this month?"],
    words: [
      ["wait", "waiting", "waited"],
      ["time", "long", "average", "median", "minute"],
    ],
    period: "range",
    defaultPeriod: "last-30-days",
    comparable: true,
    organization: true,
    requires: ["management.dashboard.read"],
    source: DASHBOARD,
    link: DASHBOARD_LINK,
  },
  {
    id: "laboratory.turnaround",
    version: 1,
    title: "Laboratory turnaround",
    examples: ["Lab turnaround this month", "Laboratory turnaround last week vs the week before"],
    words: [["turnaround", "tat"]],
    hints: [["lab", "laboratory", "result", "test"]],
    period: "range",
    defaultPeriod: "last-30-days",
    comparable: true,
    organization: true,
    requires: ["management.dashboard.read"],
    source: DASHBOARD,
    link: DASHBOARD_LINK,
  },
  {
    id: "billing.revenue",
    version: 1,
    title: "Revenue and collections",
    examples: ["Revenue this month vs last month", "Revenue last month"],
    words: [["revenue", "income", "invoiced", "billed", "earning", "sale"]],
    period: "range",
    defaultPeriod: "last-30-days",
    comparable: true,
    organization: true,
    requires: ["management.dashboard.read", "billing.report.read"],
    source: DASHBOARD,
    link: DASHBOARD_LINK,
  },
  {
    id: "inventory.stock-used",
    version: 1,
    title: "Stock used",
    examples: ["Stock used last month", "How much stock did we use this month?"],
    words: [
      ["stock", "supply", "supplies", "inventory"],
      ["used", "use", "consumed", "consumption", "usage"],
    ],
    period: "range",
    defaultPeriod: "last-30-days",
    comparable: true,
    organization: true,
    requires: ["management.dashboard.read", "inventory.valuation.read"],
    source: DASHBOARD,
    link: DASHBOARD_LINK,
  },
  {
    id: "pharmacy.dispensed",
    version: 1,
    title: "Dispensing",
    examples: ["How much was dispensed this month?", "Dispensed last week"],
    words: [["dispensed", "dispensing", "dispense"]],
    period: "range",
    defaultPeriod: "last-30-days",
    comparable: true,
    organization: true,
    requires: ["management.dashboard.read", "prescription.read"],
    source: DASHBOARD,
    link: DASHBOARD_LINK,
  },
  {
    id: "clinic.appointments",
    version: 1,
    title: "Appointments",
    examples: ["Appointments today", "Appointments tomorrow"],
    words: [["appointment", "booking", "booked", "schedule"]],
    period: "day",
    defaultPeriod: "today",
    comparable: false,
    organization: false,
    requires: ["clinic.dashboard.read"],
    source: "GET /clinic/dashboard",
    link: { label: "Open appointments", href: "/appointments" },
  },
  {
    id: "clinic.waiting-now",
    version: 1,
    title: "Who is waiting",
    examples: ["Who is waiting now?", "How many are in the queue?"],
    words: [["waiting", "wait", "queue", "line"]],
    period: "now",
    comparable: false,
    organization: false,
    requires: ["clinic.dashboard.read"],
    source: "GET /clinic/dashboard",
    link: { label: "Open the queue", href: "/queue" },
  },
  {
    id: "billing.collections",
    version: 1,
    title: "Collections",
    examples: ["Collections today", "How much did we collect yesterday?"],
    words: [["collected", "collect", "collection", "payment", "paid"]],
    period: "day",
    defaultPeriod: "today",
    comparable: false,
    organization: false,
    requires: ["billing.report.read"],
    source: "GET /billing/reports/daily",
    link: { label: "Open the daily report", href: "/billing/reports" },
  },
  {
    id: "billing.owed",
    version: 1,
    title: "What we are owed",
    examples: ["How much are we owed?", "Unpaid balances"],
    words: [["owe", "owed", "receivable", "unpaid", "outstanding", "balance"]],
    period: "none",
    comparable: false,
    organization: false,
    requires: ["billing.report.read"],
    source: "GET /billing/reports/daily",
    link: { label: "Open the invoices", href: "/billing/invoices" },
  },
  {
    id: "inventory.low",
    version: 1,
    title: "Low stock",
    examples: ["What is running low?", "Low stock"],
    words: [["low", "run out", "running out", "out of stock", "short"]],
    period: "none",
    comparable: false,
    organization: false,
    requires: ["inventory.read"],
    source: "GET /inventory/stock",
    link: { label: "Open low stock", href: "/inventory?show=low" },
  },
  {
    id: "inventory.expiring",
    version: 1,
    title: "Expiring stock",
    examples: ["What expires soon?", "Expiring stock"],
    words: [["expire", "expiring", "expiry", "expired", "expiration"]],
    period: "none",
    comparable: false,
    organization: false,
    requires: ["inventory.read"],
    source: "GET /inventory/stock",
    link: { label: "Open expiring stock", href: "/inventory?show=expiring" },
  },
  {
    id: "inventory.reorder",
    version: 1,
    title: "What to order",
    examples: ["What should we order?", "What should we reorder?"],
    words: [["reorder", "restock", "order more", "to order", "we order", "buy", "purchase"]],
    period: "none",
    comparable: false,
    organization: false,
    requires: ["inventory.read"],
    source: "GET /inventory/reorder-suggestions",
    link: { label: "Open purchase orders", href: "/inventory/purchase-orders" },
  },
  {
    id: "laboratory.today",
    version: 1,
    title: "Laboratory today",
    examples: ["What is the lab waiting on?", "Critical results waiting"],
    words: [["lab", "laboratory", "specimen", "sample", "result", "critical"]],
    hints: [["waiting", "pending", "backlog", "awaiting", "critical"]],
    period: "now",
    comparable: false,
    organization: false,
    requires: ["lab.dashboard.read"],
    source: "GET /laboratory/dashboard",
    link: { label: "Open the workbench", href: "/laboratory/worklist" },
  },
];

export function askQuestion(id: string): AskQuestionDefinition | undefined {
  return ASK_QUESTIONS.find((q) => q.id === id);
}
