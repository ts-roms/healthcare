/**
 * The Settings area: every configuration page of the platform in one place, grouped, beside a sub-navigation.
 *
 * Nothing moves: each page keeps its address and its own permission check. This list only decides what the Settings
 * menu offers (from the permissions the API grants, mirroring each page's own check so the menu never links to a page
 * that sends the user back to the dashboard) and which pages are drawn inside the Settings frame.
 */
export interface SettingsPage {
  label: string;
  href: string;
  /** Any one of these permissions opens the page; empty = everyone who is signed in. */
  permissions: string[];
  description: string;
}

export interface SettingsGroup {
  label: string;
  pages: SettingsPage[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Clinical",
    pages: [
      {
        label: "Procedures",
        href: "/clinic/procedures",
        permissions: ["encounter.read"],
        description: "The procedures this clinic performs, their consent wording and supplies.",
      },
      { label: "Vaccines", href: "/clinic/vaccines", permissions: ["immunization.read"], description: "The vaccines this clinic gives." },
      { label: "Coding systems", href: "/clinic/coding-systems", permissions: ["encounter.read"], description: "The diagnosis coding systems in use." },
      {
        label: "Referral follow-up",
        href: "/clinic/referrals/settings",
        permissions: ["clinic.configure"],
        description: "When a referral still awaiting the recipient counts as overdue.",
      },
      {
        label: "Signatures",
        href: "/clinic/signatures",
        permissions: ["clinic.configure"],
        description: "Whether issued certificates and referrals carry the practitioner's drawn signature.",
      },
      {
        label: "Dental",
        href: "/dental/settings",
        permissions: ["dental.record.read"],
        description: "Dental procedure codes, supplies and estimate settings.",
      },
    ],
  },
  {
    label: "Scheduling",
    pages: [
      {
        label: "Schedules",
        href: "/appointments/schedules",
        permissions: ["appointment.read"],
        description: "Weekly schedules, closures, practitioners and rooms.",
      },
      {
        label: "Visit types & booking",
        href: "/appointments/visit-types",
        permissions: ["appointment.read"],
        description: "Which visit types patients may book online, and each clinic's booking rules.",
      },
    ],
  },
  {
    label: "Laboratory",
    pages: [
      {
        label: "Test catalog",
        href: "/laboratory/catalog",
        permissions: ["lab.order.read"],
        description: "Tests, reference ranges, panels and facility policy.",
      },
      {
        label: "Instruments",
        href: "/laboratory/instruments",
        permissions: ["lab.qc.read"],
        description: "Analyzers, their maintenance and calibration log, and reagent lots.",
      },
      {
        label: "Licence",
        href: "/laboratory/licence",
        permissions: ["lab.qc.read"],
        description: "The facility's laboratory licence as recorded, with a reminder window.",
      },
    ],
  },
  {
    label: "Operations",
    pages: [
      {
        label: "Billing",
        href: "/billing/settings",
        permissions: ["billing.pricelist.manage"],
        description: "Services and prices, discounts, payers, tax and document numbers.",
      },
      {
        label: "Inventory catalog",
        href: "/inventory/catalog",
        permissions: ["inventory.catalog.manage"],
        description: "Items, suppliers, locations and reorder levels.",
      },
      {
        label: "Patient messages",
        href: "/messages/settings",
        permissions: ["patient.message.read"],
        description: "Who receives each topic of patient messages and how fast they answer.",
      },
      {
        label: "Records requests",
        href: "/records/requests/settings",
        permissions: ["patient.records-request.manage"],
        description: "How patients' requests for their records are answered.",
      },
      {
        label: "Disease reporting",
        href: "/reporting/settings",
        permissions: ["doh.settings.manage"],
        description: "Reportable conditions and your reporting deadlines.",
      },
    ],
  },
  {
    label: "Organization",
    pages: [
      {
        label: "Staff users",
        href: "/admin/users",
        permissions: ["user.read"],
        description: "Who can sign in, their roles and where each applies; suspend and reactivate.",
      },
      { label: "Roles & permissions", href: "/admin/roles", permissions: ["user.read"], description: "What each role allows; your organization's own roles." },
      {
        label: "Facilities",
        href: "/admin/facilities",
        permissions: ["organization.read"],
        description: "Clinics, laboratories and other sites, and their departments.",
      },
      {
        label: "Service points",
        href: "/admin/service-points",
        permissions: ["clinic.configure"],
        description: "Where a triaged patient can be sent at each facility: the consultation line, the emergency room, X-ray and other stations.",
      },
      { label: "Company", href: "/admin/organization", permissions: ["organization.read"], description: "Your organization's name and identifier." },
    ],
  },
  {
    label: "Security & privacy",
    pages: [
      {
        label: "Sign-in security",
        href: "/admin/security",
        permissions: ["user.read"],
        description: "Whether staff must use two-step verification, who still needs it, and exempt integration accounts.",
      },
      { label: "Audit log", href: "/admin/audit", permissions: ["audit.read"], description: "Who did what, when and to which record." },
      {
        label: "Consent wording",
        href: "/admin/consent-wording",
        permissions: ["consent.wording.manage"],
        description: "The wording patients agree to when they give consent online.",
      },
      {
        label: "Data privacy",
        href: "/admin/privacy",
        permissions: ["privacy.incident.manage"],
        description: "The personal data breach register, your notification window and your Data Protection Officer.",
      },
      {
        label: "Patient QR codes",
        href: "/admin/patient-qr",
        permissions: ["patient.qr.manage"],
        description: "Whether patients get a QR code on a card, when it is issued and what it holds.",
      },
      {
        label: "Compliance",
        href: "/admin/compliance",
        permissions: ["compliance.review.manage"],
        description: "Your organization's own compliance configuration and who validated it.",
      },
      {
        label: "Integrations",
        href: "/admin/integrations",
        permissions: ["integration.exchange.manage"],
        description: "Outbound exchanges that failed or stalled.",
      },
    ],
  },
];

/** The Settings home. Its own page lists every page open to the user. */
export const SETTINGS_HOME = "/admin";

const ALL_PAGES = SETTINGS_GROUPS.flatMap((g) => g.pages);

/** The settings pages open to someone with these permissions, still grouped; empty groups are left out. */
export function settingsForPermissions(permissions: readonly string[]): SettingsGroup[] {
  const granted = new Set(permissions);
  const open = (page: SettingsPage) => page.permissions.length === 0 || page.permissions.some((p) => granted.has(p));
  return SETTINGS_GROUPS.map((group) => ({ ...group, pages: group.pages.filter(open) })).filter((group) => group.pages.length > 0);
}

/** Whether a page is drawn inside the Settings frame: the Settings home, every administration page and each settings page (and its sub-pages). */
export function isSettingsPath(pathname: string): boolean {
  if (pathname === SETTINGS_HOME || pathname.startsWith(`${SETTINGS_HOME}/`)) return true;
  return ALL_PAGES.some((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
}
