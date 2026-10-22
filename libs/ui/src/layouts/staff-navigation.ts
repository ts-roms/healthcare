import {
  CalendarDaysIcon,
  CalendarRangeIcon,
  ChartColumnIcon,
  CircleHelpIcon,
  ClipboardPenIcon,
  FileInputIcon,
  FileWarningIcon,
  FlaskConicalIcon,
  InboxIcon,
  LayoutDashboardIcon,
  ListOrderedIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  MonitorIcon,
  PackageIcon,
  PillIcon,
  ReceiptIcon,
  SendIcon,
  SettingsIcon,
  SmileIcon,
  StethoscopeIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { StaffRole } from "@healthcare/domain";

/** The sidebar's sections, in order. Items of one group sit together under its label. */
export const NAV_GROUPS = ["Today", "Patients", "Clinical", "Operations", "Engagement"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export interface NavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** The sidebar section. Items without one (and not `placement: "footer"`) are listed first, ungrouped. */
  group?: NavGroup;
  /** `footer` pins the item to the bottom of the sidebar (Settings, Help), below the groups. */
  placement?: "footer";
  /** Marks the item current on pages beyond `href` and its sub-paths (e.g. a module whose screens live under several prefixes). */
  match?: (pathname: string) => boolean;
  /** Roles that can see this item. Omit = everyone. */
  roles?: StaffRole[];
  /** Short tag shown next to the label, e.g. "Demo" for modules without a backend yet. */
  badge?: string;
  /** Items waiting in the module (e.g. messages awaiting a reply); shown as a number with an accessible label. */
  count?: number;
  /** The count needs action (unacknowledged critical results): danger colours, announced as "need attention". */
  countAlert?: boolean;
  children?: NavItem[];
}

const CLINICAL: StaffRole[] = ["doctor", "nurse", "admin"];
const FRONT_DESK: StaffRole[] = ["doctor", "nurse", "reception", "dentist", "admin"];

/**
 * Master navigation. The sidebar is filtered per role so, for example, a lab
 * technician sees Dashboard + Laboratory + Communications, not 30 modules.
 *
 * A module is ONE entry; its sub-pages are the module tabs under the page header (`ModuleTabs`), and every module's
 * configuration lives in the Settings area (the footer entry). Pages that used to be sub-items (Doctors, Vaccines,
 * Instruments, …) keep their addresses.
 */
export const STAFF_NAVIGATION: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboardIcon, group: "Today" },
  { label: "Queue", href: "/queue", icon: ListOrderedIcon, group: "Today", roles: [...FRONT_DESK, "billing"] },
  {
    label: "Appointments",
    href: "/appointments",
    icon: CalendarDaysIcon,
    group: "Today",
    roles: FRONT_DESK,
    match: (p) =>
      p === "/appointments" ||
      (p.startsWith("/appointments/") && !p.startsWith("/appointments/visit-types") && !p.startsWith("/appointments/schedules")) ||
      p === "/doctors" ||
      p.startsWith("/doctors/"),
  },
  { label: "Calendar", href: "/calendar", icon: CalendarRangeIcon, group: "Today", roles: FRONT_DESK },

  { label: "Patients", href: "/patients", icon: UsersIcon, group: "Patients", roles: ["doctor", "nurse", "reception", "dentist", "billing", "admin"] },
  { label: "Patient messages", href: "/messages", icon: InboxIcon, group: "Patients" },
  { label: "Telemedicine", href: "/telemedicine", icon: MonitorIcon, group: "Patients", roles: ["doctor", "admin"] },

  {
    label: "Consultations",
    href: "/clinic/encounters",
    icon: StethoscopeIcon,
    group: "Clinical",
    roles: CLINICAL,
    match: (p) => p.startsWith("/clinic/encounters") || p.startsWith("/clinic/prescriptions"),
  },
  { label: "Care plans", href: "/clinic/care-plans", icon: ClipboardPenIcon, group: "Clinical", roles: CLINICAL },
  {
    label: "Referrals",
    href: "/clinic/referrals",
    icon: SendIcon,
    group: "Clinical",
    roles: ["doctor", "admin"],
    match: (p) => p === "/clinic/referrals" || (p.startsWith("/clinic/referrals/") && p !== "/clinic/referrals/settings"),
  },
  { label: "Laboratory", href: "/laboratory", icon: FlaskConicalIcon, group: "Clinical", roles: ["lab-tech", "doctor", "nurse", "admin"] },
  {
    label: "Dental",
    href: "/dental",
    icon: SmileIcon,
    group: "Clinical",
    roles: ["dentist", "admin"],
    match: (p) => p === "/dental" || (p.startsWith("/dental/") && p !== "/dental/settings"),
  },
  { label: "Pharmacy", href: "/pharmacy", icon: PillIcon, group: "Clinical", roles: ["nurse", "admin"] },

  { label: "Billing", href: "/billing", icon: ReceiptIcon, group: "Operations", roles: ["billing", "reception", "admin"] },
  { label: "Inventory", href: "/inventory", icon: PackageIcon, group: "Operations", roles: ["nurse", "lab-tech", "admin"] },
  { label: "Records", href: "/records", icon: FileInputIcon, group: "Operations", roles: ["admin"] },
  { label: "Disease reporting", href: "/reporting", icon: FileWarningIcon, group: "Operations", roles: ["doctor", "admin"] },
  { label: "Management", href: "/management", icon: ChartColumnIcon, group: "Operations", roles: ["admin"] },

  { label: "Communications", href: "/communications", icon: MessageSquareIcon, group: "Engagement" },
  { label: "Outreach", href: "/outreach", icon: MegaphoneIcon, group: "Engagement", roles: ["admin"] },

  {
    label: "Settings",
    href: "/admin",
    icon: SettingsIcon,
    placement: "footer",
    roles: ["admin", "doctor", "nurse", "lab-tech", "reception", "billing", "dentist"],
  },
  { label: "Help", href: "/help", icon: CircleHelpIcon, placement: "footer" },
];

export function navigationForRole(role: StaffRole, items: NavItem[] = STAFF_NAVIGATION): NavItem[] {
  return items
    .filter((i) => !i.roles || i.roles.includes(role))
    .map((i) => (i.children ? { ...i, children: navigationForRole(role, i.children) } : i))
    .filter((i) => !i.children || i.children.length > 0);
}
