import type { ComplianceArea } from "@/lib/api/types";

/** What each area's configuration is and where it is set; the platform encodes none of the rules. */
export const COMPLIANCE_AREAS: Record<ComplianceArea, { label: string; covers: string; href: string }> = {
  billing_tax: {
    label: "Billing tax and documents",
    covers: "Tax profile, VAT classes and rate, document text and authorized number ranges",
    href: "/billing/settings",
  },
  procurement: {
    label: "Procurement and withholding",
    covers: "Procurement methods and their references, withholding codes used when paying suppliers",
    href: "/inventory/compliance",
  },
  controlled_drugs: {
    label: "Controlled drugs",
    covers: "Controlled items, the register's licence reference and responsible person, dispensing references",
    href: "/inventory/controlled-register",
  },
  laboratory_licensing: {
    label: "Laboratory licensing",
    covers: "Each facility's laboratory licence as recorded and its reminder window",
    href: "/laboratory/licence",
  },
  doh_reporting: {
    label: "DOH reporting",
    covers: "Reportable conditions, their categories and reporting deadlines, facility codes",
    href: "/reporting/settings",
  },
  data_privacy: {
    label: "Data privacy",
    covers: "Document retention periods and the records-request procedure (response time, identity check, notice)",
    href: "/records/retention",
  },
  dental_estimates: {
    label: "Dental written estimates",
    covers: "Estimate validity, the note under estimates and whether a signed estimate is required",
    href: "/dental/settings",
  },
};
