import {
  BuildingIcon,
  CalendarDaysIcon,
  FlaskConicalIcon,
  LayoutDashboardIcon,
  ListOrderedIcon,
  MessageSquareIcon,
  MonitorIcon,
  ReceiptIcon,
  SmileIcon,
  StethoscopeIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { StaffRole } from "@healthcare/domain";

export interface NavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** Roles that can see this item. Omit = everyone. */
  roles?: StaffRole[];
  children?: NavItem[];
}

const CLINICAL: StaffRole[] = ["doctor", "nurse", "admin"];
const FRONT_DESK: StaffRole[] = ["doctor", "nurse", "reception", "dentist", "admin"];

/**
 * Master navigation. The sidebar is filtered per role so, for example, a lab
 * technician sees Dashboard + Laboratory + Communications, not 30 modules.
 */
export const STAFF_NAVIGATION: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboardIcon },
  { label: "Patients", href: "/patients", icon: UsersIcon, roles: ["doctor", "nurse", "reception", "dentist", "billing", "admin"] },
  { label: "Appointments", href: "/appointments", icon: CalendarDaysIcon, roles: FRONT_DESK },
  { label: "Queue", href: "/queue", icon: ListOrderedIcon, roles: [...FRONT_DESK, "billing"] },
  {
    label: "Clinic",
    href: "/clinic",
    icon: StethoscopeIcon,
    roles: CLINICAL,
    children: [
      { label: "Encounters", href: "/clinic/encounters" },
      { label: "Care Plans", href: "/clinic/care-plans" },
      { label: "Prescriptions", href: "/clinic/prescriptions", roles: ["doctor", "admin"] },
      { label: "Referrals", href: "/clinic/referrals", roles: ["doctor", "admin"] },
    ],
  },
  {
    label: "Laboratory",
    href: "/laboratory",
    icon: FlaskConicalIcon,
    roles: ["lab-tech", "doctor", "nurse", "admin"],
    children: [
      { label: "Worklists", href: "/laboratory/worklist", roles: ["lab-tech", "admin"] },
      { label: "Orders", href: "/laboratory/orders" },
      { label: "Specimens", href: "/laboratory/specimens", roles: ["lab-tech", "nurse", "admin"] },
      { label: "Results", href: "/laboratory/results" },
      { label: "Quality Control", href: "/laboratory/qc", roles: ["lab-tech", "admin"] },
    ],
  },
  { label: "Dental", href: "/dental", icon: SmileIcon, roles: ["dentist", "admin"] },
  { label: "Telemedicine", href: "/telemedicine", icon: MonitorIcon, roles: ["doctor", "admin"] },
  { label: "Billing", href: "/billing", icon: ReceiptIcon, roles: ["billing", "reception", "admin"] },
  { label: "Communications", href: "/communications", icon: MessageSquareIcon },
  { label: "Administration", href: "/admin", icon: BuildingIcon, roles: ["admin"] },
];

export function navigationForRole(role: StaffRole, items: NavItem[] = STAFF_NAVIGATION): NavItem[] {
  return items
    .filter((i) => !i.roles || i.roles.includes(role))
    .map((i) => (i.children ? { ...i, children: navigationForRole(role, i.children) } : i))
    .filter((i) => !i.children || i.children.length > 0);
}
