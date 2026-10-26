import type { StaffBadges } from "./api/types";
import { STAFF_NAVIGATION, type NavItem } from "@healthcare/ui/layouts";
import { isSettingsPath, SETTINGS_HOME, settingsForPermissions } from "./settings-navigation";

/** Modules whose screens still run on demo fixtures (their API may exist but is not wired yet). */
export const DEMO_MODULES: string[] = [];

/** Which permissions reveal each top-level module (any one is enough). Unlisted modules are visible to everyone. */
const MODULE_PERMISSIONS: Record<string, string[]> = {
  "/patients": ["patient.search"],
  "/calendar": ["calendar.read"],
  "/appointments": ["appointment.read"],
  "/doctors": ["appointment.read"],
  "/queue": ["clinic.queue.read"],
  "/clinic/encounters": ["encounter.read"],
  "/clinic/care-plans": ["care-plan.read"],
  "/clinic/referrals": ["encounter.read"],
  "/laboratory": ["lab.order.read"],
  "/dental": ["dental.record.read"],
  "/telemedicine": ["telemedicine.read"],
  "/billing": ["billing.charge.read"],
  "/pharmacy": ["prescription.dispense"],
  "/inventory": ["inventory.read"],
  "/communications": ["notification.read"],
  "/outreach": ["crm.read"],
  "/management": ["management.dashboard.read"],
  "/reporting": ["doh.report.manage"],
  "/records": [
    "interop.fhir.import.review",
    "patient.records-request.manage",
    "document.retention.manage",
    "document.integrity.manage",
    "outside-result.submission.manage",
  ],
  "/messages": ["patient.message.read"],
};

/**
 * Navigation for the signed-in user, from the permissions the API grants (not a client-side role). A module whose
 * pages are all out of reach is left out; Settings appears when at least one settings page is open to the user.
 */
export function navigationForPermissions(permissions: readonly string[], items: NavItem[] = STAFF_NAVIGATION): NavItem[] {
  const granted = new Set(permissions);
  const allowed = (required: string[] | undefined) => !required || required.some((p) => granted.has(p));
  const hasSettings = settingsForPermissions(permissions).length > 0;
  return items
    .filter((item) => (item.href === SETTINGS_HOME ? hasSettings : allowed(MODULE_PERMISSIONS[item.href])))
    .map((item) => {
      // Per-role filtering is a demo concept; the permissions above decide.
      const { roles: _roles, children: _children, ...rest } = item;
      const settings = item.href === SETTINGS_HOME ? { match: isSettingsPath } : {};
      return { ...rest, ...settings, ...(DEMO_MODULES.includes(item.href) ? { badge: "Demo" } : {}) };
    });
}

export function isDemoPath(pathname: string): boolean {
  return DEMO_MODULES.some((m) => pathname === m || pathname.startsWith(`${m}/`)) || pathname.startsWith("/preview/");
}

/** Which navigation entry shows which count (`GET /me/badges`); a module's count is the sum of what it lists. */
export const BADGE_COUNTS: Record<string, (b: StaffBadges) => number | null> = {
  "/messages": (b) => b.messagesAwaiting,
  "/laboratory": (b) => b.criticalResults,
  "/records": (b) => b.recordsRequests,
  "/reporting": (b) => b.caseReports,
};

/** Counts that need action (a danger colour with a "need attention" label) rather than just waiting. */
const ALERT_COUNTS = new Set(["/laboratory"]);

/** Adds the counts to the navigation entries that have one (0 and withheld counts show nothing). */
export function withBadgeCounts(items: NavItem[], badges: StaffBadges | null): NavItem[] {
  if (!badges) return items;
  return items.map((item) => {
    const count = BADGE_COUNTS[item.href]?.(badges) ?? null;
    return count ? { ...item, count, ...(ALERT_COUNTS.has(item.href) ? { countAlert: true } : {}) } : item;
  });
}
