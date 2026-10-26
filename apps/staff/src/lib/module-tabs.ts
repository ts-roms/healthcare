import type { ModuleTab } from "@healthcare/ui/layouts";
import type { StaffBadges } from "./api/types";
import { isSettingsPath } from "./settings-navigation";

/**
 * The sub-pages of each module, shown as tabs under the top bar (`ModuleTabs`) instead of sidebar children and rows of
 * header buttons. Each tab is gated by the same permission as its page, so a tab is never offered that sends the user
 * back to the dashboard. A module's configuration pages are not tabs: they live in the Settings area.
 */
interface TabDefinition {
  label: string;
  href: string;
  /** Any one of these permissions opens the page. */
  permissions: string[];
  /** The tab's count, from `GET /me/badges`; `alert` when it needs action. */
  count?: (badges: StaffBadges) => number | null;
  alert?: boolean;
}

interface ModuleDefinition {
  label: string;
  /** Pages under any of these prefixes belong to the module. */
  prefixes: string[];
  tabs: TabDefinition[];
}

const MODULES: ModuleDefinition[] = [
  {
    label: "Laboratory",
    prefixes: ["/laboratory"],
    tabs: [
      { label: "Worklist", href: "/laboratory/worklist", permissions: ["lab.order.read"] },
      { label: "Critical results", href: "/laboratory/critical", permissions: ["lab.result.read"], count: (b) => b.criticalResults, alert: true },
      { label: "Send-outs", href: "/laboratory/send-outs", permissions: ["lab.order.read"] },
      { label: "Instrument results", href: "/laboratory/instrument-results", permissions: ["lab.result.read"] },
      { label: "Quality control", href: "/laboratory/qc", permissions: ["lab.qc.read"] },
      { label: "Reagent use", href: "/laboratory/reagents", permissions: ["lab.qc.read"] },
      { label: "Temperatures", href: "/laboratory/temperatures", permissions: ["lab.qc.read"] },
      { label: "Nonconformances", href: "/laboratory/nonconformances", permissions: ["lab.qc.read"] },
      { label: "Proficiency testing", href: "/laboratory/eqa", permissions: ["lab.qc.read"] },
      { label: "Competency", href: "/laboratory/competency", permissions: ["lab.qc.read"] },
    ],
  },
  {
    label: "Billing",
    prefixes: ["/billing"],
    tabs: [
      { label: "Cashier", href: "/billing", permissions: ["billing.charge.read"] },
      { label: "Invoices", href: "/billing/invoices", permissions: ["billing.charge.read"] },
      { label: "Daily report", href: "/billing/reports", permissions: ["billing.report.read"] },
    ],
  },
  {
    label: "Inventory",
    prefixes: ["/inventory"],
    tabs: [
      { label: "Stock", href: "/inventory", permissions: ["inventory.read"] },
      { label: "Movements", href: "/inventory/movements", permissions: ["inventory.read"] },
      { label: "Purchase orders", href: "/inventory/purchase-orders", permissions: ["inventory.read"] },
      { label: "Supplier invoices", href: "/inventory/supplier-invoices", permissions: ["inventory.read"] },
      { label: "Valuation", href: "/inventory/valuation", permissions: ["inventory.valuation.read"] },
      { label: "Controlled register", href: "/inventory/controlled-register", permissions: ["inventory.controlled-register.read"] },
      { label: "Tax and procurement", href: "/inventory/compliance", permissions: ["inventory.read"] },
    ],
  },
  {
    label: "Consultations",
    prefixes: ["/clinic/encounters", "/clinic/prescriptions", "/clinic/outside-results"],
    tabs: [
      { label: "Consultations", href: "/clinic/encounters", permissions: ["encounter.read"] },
      { label: "Prescriptions", href: "/clinic/prescriptions", permissions: ["prescription.read"] },
      {
        label: "Outside results",
        href: "/clinic/outside-results",
        permissions: ["outside-result.review"],
        count: (b) => b.outsideResultsUnreviewed,
        alert: true,
      },
    ],
  },
  {
    label: "Appointments",
    prefixes: ["/appointments", "/doctors"],
    tabs: [
      { label: "Day view", href: "/appointments", permissions: ["appointment.read"] },
      { label: "Waiting list", href: "/appointments/waitlist", permissions: ["appointment.read"] },
      { label: "Doctors", href: "/doctors", permissions: ["appointment.read"] },
    ],
  },
  {
    label: "Records",
    prefixes: ["/records"],
    tabs: [
      { label: "Requests", href: "/records/requests", permissions: ["patient.records-request.manage"], count: (b) => b.recordsRequests },
      { label: "Imports", href: "/records/imports", permissions: ["interop.fhir.import.review"] },
      {
        label: "Outside results",
        href: "/records/outside-results",
        permissions: ["outside-result.submission.manage"],
        count: (b) => b.outsideResultSubmissions,
      },
      { label: "Integrity", href: "/records/integrity", permissions: ["document.integrity.manage"] },
      { label: "Retention", href: "/records/retention", permissions: ["document.retention.manage"] },
    ],
  },
  {
    label: "Management",
    prefixes: ["/management"],
    tabs: [
      { label: "Dashboard", href: "/management", permissions: ["management.dashboard.read"] },
      { label: "Scheduled reports", href: "/management/reports", permissions: ["management.dashboard.read"] },
    ],
  },
];

export interface ModuleTabsForPage {
  /** Names the navigation for assistive technology, e.g. "Billing sections". */
  label: string;
  tabs: ModuleTab[];
}

/**
 * The tabs for the page being shown, or `null` when the page belongs to no module, is a settings page (they have the
 * Settings sub-navigation) or the module has fewer than two tabs open to the user (nothing to switch between).
 */
export function moduleTabsFor(pathname: string, permissions: readonly string[], badges: StaffBadges | null = null): ModuleTabsForPage | null {
  if (isSettingsPath(pathname)) return null;
  const found = MODULES.find((m) => m.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)));
  if (!found) return null;
  const granted = new Set(permissions);
  const tabs = found.tabs
    .filter((tab) => tab.permissions.some((p) => granted.has(p)))
    .map<ModuleTab>((tab) => {
      const count = badges ? (tab.count?.(badges) ?? 0) : 0;
      return { href: tab.href, label: tab.label, ...(count ? { count, alert: tab.alert } : {}) };
    });
  return tabs.length >= 2 ? { label: `${found.label} sections`, tabs } : null;
}
