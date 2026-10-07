import type { StaffBadges } from "./api/types";
import { STAFF_NAVIGATION, type NavItem } from "@healthcare/ui/layouts";

/** Modules whose screens still run on demo fixtures (their API may exist but is not wired yet). */
export const DEMO_MODULES: string[] = [];

/** Which permissions reveal each top-level module (any one is enough). Unlisted modules are visible to everyone. */
const MODULE_PERMISSIONS: Record<string, string[]> = {
  "/patients": ["patient.search"],
  "/calendar": ["calendar.read"],
  "/appointments": ["appointment.read"],
  "/doctors": ["appointment.read"],
  "/queue": ["clinic.queue.read"],
  "/clinic": ["encounter.read"],
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
  "/records": ["interop.fhir.import.review", "patient.records-request.manage", "document.retention.manage", "document.integrity.manage"],
  "/messages": ["patient.message.read"],
  "/admin": [
    "user.read",
    "user.manage",
    "role.manage",
    "organization.manage",
    "audit.read",
    "integration.exchange.manage",
    "compliance.review.manage",
    "consent.wording.manage",
  ],
};

/**
 * Pages inside a module that need more than the module's own permission (any one is enough). They mirror each
 * page's own check, so the menu never offers a page that sends the user back to the dashboard.
 */
const PAGE_PERMISSIONS: Record<string, string[]> = {
  "/clinic/care-plans": ["care-plan.read"],
  "/clinic/vaccines": ["immunization.read"],
  "/clinic/procedures": ["encounter.read"],
  "/clinic/coding-systems": ["encounter.read"],
  "/laboratory/critical": ["lab.result.read"],
  "/laboratory/instrument-results": ["lab.result.read"],
  "/laboratory/qc": ["lab.qc.read"],
  "/laboratory/instruments": ["lab.qc.read"],
  "/laboratory/reagents": ["lab.qc.read"],
  "/laboratory/temperatures": ["lab.qc.read"],
  "/laboratory/nonconformances": ["lab.qc.read"],
  "/laboratory/eqa": ["lab.qc.read"],
  "/laboratory/competency": ["lab.qc.read"],
  "/laboratory/licence": ["lab.qc.read"],
  "/management/reports": ["management.dashboard.read"],
  "/records/imports": ["interop.fhir.import.review"],
  "/records/retention": ["document.retention.manage"],
  "/records/integrity": ["document.integrity.manage"],
  "/records/requests": ["patient.records-request.manage"],
  "/messages/settings": ["patient.message.read"],
  "/admin/organization": ["organization.read"],
  "/admin/users": ["user.read"],
  "/admin/security": ["user.read"],
  "/admin/roles": ["user.read"],
  "/admin/facilities": ["organization.read"],
  "/admin/audit": ["audit.read"],
  "/admin/integrations": ["integration.exchange.manage"],
  "/admin/compliance": ["compliance.review.manage"],
  "/admin/consent-wording": ["consent.wording.manage"],
};

/**
 * Navigation for the signed-in user, from the permissions the API grants (not a client-side role). A module whose
 * pages are all out of reach is left out.
 */
export function navigationForPermissions(permissions: readonly string[], items: NavItem[] = STAFF_NAVIGATION): NavItem[] {
  const granted = new Set(permissions);
  const allowed = (required: string[] | undefined) => !required || required.some((p) => granted.has(p));
  return items
    .filter((item) => allowed(MODULE_PERMISSIONS[item.href]))
    .map((item) => {
      // Children pass the module's gate and their own page's; per-role child filtering is a demo concept.
      const { roles: _roles, ...rest } = item;
      const children = item.children?.filter((child) => allowed(PAGE_PERMISSIONS[child.href])).map(({ roles: _r, ...child }) => child);
      return { ...rest, ...(children ? { children } : {}), ...(DEMO_MODULES.includes(item.href) ? { badge: "Demo" } : {}) };
    })
    .filter((item) => !item.children || item.children.length > 0);
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

/** Adds the counts to the navigation entries that have one (0 and withheld counts show nothing). */
export function withBadgeCounts(items: NavItem[], badges: StaffBadges | null): NavItem[] {
  if (!badges) return items;
  return items.map((item) => {
    const count = BADGE_COUNTS[item.href]?.(badges) ?? null;
    return count ? { ...item, count } : item;
  });
}
