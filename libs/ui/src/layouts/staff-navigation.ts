import {
  BuildingIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  CalendarDaysIcon,
  FileInputIcon,
  FlaskConicalIcon,
  CircleHelpIcon,
  LayoutDashboardIcon,
  ListOrderedIcon,
  MessageSquareIcon,
  MonitorIcon,
  PackageIcon,
  PillIcon,
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
  /** Short tag shown next to the label, e.g. "Demo" for modules without a backend yet. */
  badge?: string;
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
      { label: "Workbench", href: "/laboratory/worklist", roles: ["lab-tech", "admin"] },
      { label: "Send-outs", href: "/laboratory/send-outs", roles: ["lab-tech", "admin"] },
      { label: "Critical results", href: "/laboratory/critical" },
      { label: "Instrument results", href: "/laboratory/instrument-results", roles: ["lab-tech", "admin"] },
      { label: "Catalog", href: "/laboratory/catalog", roles: ["lab-tech", "admin"] },
      { label: "Quality control", href: "/laboratory/qc", roles: ["lab-tech", "admin"] },
      { label: "Instruments", href: "/laboratory/instruments", roles: ["lab-tech", "admin"] },
      { label: "Reagent use", href: "/laboratory/reagents", roles: ["lab-tech", "admin"] },
      { label: "Temperatures", href: "/laboratory/temperatures", roles: ["lab-tech", "admin"] },
      { label: "Nonconformances", href: "/laboratory/nonconformances", roles: ["lab-tech", "admin"] },
      { label: "Proficiency testing", href: "/laboratory/eqa", roles: ["lab-tech", "admin"] },
      { label: "Competency", href: "/laboratory/competency", roles: ["lab-tech", "admin"] },
      { label: "Licence", href: "/laboratory/licence", roles: ["lab-tech", "admin"] },
    ],
  },
  {
    label: "Dental",
    href: "/dental",
    icon: SmileIcon,
    roles: ["dentist", "admin"],
    children: [
      { label: "Today's patients", href: "/dental" },
      { label: "Settings", href: "/dental/settings", roles: ["admin"] },
    ],
  },
  { label: "Telemedicine", href: "/telemedicine", icon: MonitorIcon, roles: ["doctor", "admin"] },
  { label: "Billing", href: "/billing", icon: ReceiptIcon, roles: ["billing", "reception", "admin"] },
  { label: "Pharmacy", href: "/pharmacy", icon: PillIcon, roles: ["nurse", "admin"] },
  { label: "Inventory", href: "/inventory", icon: PackageIcon, roles: ["nurse", "lab-tech", "admin"] },
  { label: "Communications", href: "/communications", icon: MessageSquareIcon },
  { label: "Management", href: "/management", icon: ChartColumnIcon, roles: ["admin"] },
  { label: "Disease reporting", href: "/reporting", icon: ClipboardListIcon, roles: ["doctor", "admin"] },
  {
    label: "Records",
    href: "/records",
    icon: FileInputIcon,
    roles: ["admin"],
    children: [
      { label: "Requests", href: "/records/requests" },
      { label: "Imports", href: "/records/imports" },
      { label: "Retention", href: "/records/retention" },
    ],
  },
  {
    label: "Administration",
    href: "/admin",
    icon: BuildingIcon,
    roles: ["admin"],
    children: [
      { label: "Integrations", href: "/admin/integrations" },
      { label: "Compliance", href: "/admin/compliance" },
    ],
  },
  { label: "Help", href: "/help", icon: CircleHelpIcon },
];

export function navigationForRole(role: StaffRole, items: NavItem[] = STAFF_NAVIGATION): NavItem[] {
  return items
    .filter((i) => !i.roles || i.roles.includes(role))
    .map((i) => (i.children ? { ...i, children: navigationForRole(role, i.children) } : i))
    .filter((i) => !i.children || i.children.length > 0);
}
