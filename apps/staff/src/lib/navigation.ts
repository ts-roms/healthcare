import { STAFF_NAVIGATION, type NavItem } from "@healthcare/ui/layouts";

/** Modules whose screens still run on demo fixtures (their API may exist but is not wired yet). */
export const DEMO_MODULES = ["/dental"];

/** Which permissions reveal each top-level module (any one is enough). Unlisted modules are visible to everyone. */
const MODULE_PERMISSIONS: Record<string, string[]> = {
  "/patients": ["patient.search"],
  "/appointments": ["appointment.read"],
  "/queue": ["clinic.queue.read"],
  "/clinic": ["encounter.read"],
  "/laboratory": ["lab.order.read"],
  "/dental": ["patient.read"],
  "/telemedicine": ["telemedicine.read"],
  "/billing": ["billing.charge.read"],
  "/inventory": ["inventory.read"],
  "/communications": ["notification.read", "notification.send"],
  "/reporting": ["doh.report.manage"],
  "/admin": ["user.read", "user.manage", "role.manage", "organization.manage", "integration.exchange.manage"],
};

/** Navigation for the signed-in user, from the permissions the API grants (not a client-side role). */
export function navigationForPermissions(permissions: readonly string[], items: NavItem[] = STAFF_NAVIGATION): NavItem[] {
  const granted = new Set(permissions);
  return items
    .filter((item) => {
      const required = MODULE_PERMISSIONS[item.href];
      return !required || required.some((p) => granted.has(p));
    })
    .map((item) => {
      // Children inherit the module's gate; per-role child filtering is a demo concept.
      const { roles: _roles, ...rest } = item;
      const children = item.children?.map(({ roles: _r, ...child }) => child);
      return { ...rest, ...(children ? { children } : {}), ...(DEMO_MODULES.includes(item.href) ? { badge: "Demo" } : {}) };
    });
}

export function isDemoPath(pathname: string): boolean {
  return DEMO_MODULES.some((m) => pathname === m || pathname.startsWith(`${m}/`)) || pathname.startsWith("/preview/");
}
