import { describe, expect, it } from "vitest";
import type { StaffBadges } from "./api/types";
import { moduleTabsFor } from "./module-tabs";
import { isDemoPath, navigationForPermissions, withBadgeCounts } from "./navigation";
import { isSettingsPath, settingsForPermissions } from "./settings-navigation";

const hrefs = (permissions: string[]) => navigationForPermissions(permissions).map((i) => i.href);

describe("navigationForPermissions", () => {
  it("shows only the dashboard and help to a user without relevant permissions", () => {
    expect(hrefs([])).toEqual(["/", "/help"]);
  });

  it("shows patient lookup to users who can search patients", () => {
    expect(hrefs(["patient.search"])).toContain("/patients");
    expect(hrefs(["audit.read"])).not.toContain("/patients");
  });

  it("shows the API-backed dental module by dental permission, without a demo badge", () => {
    expect(hrefs(["patient.search", "patient.read"])).not.toContain("/dental");
    const dental = navigationForPermissions(["dental.record.read"]).find((i) => i.href === "/dental");
    expect(dental?.badge).toBeUndefined();
    // The module is one entry; its settings page is in Settings.
    expect(dental?.children).toBeUndefined();
  });

  it("shows the API-backed laboratory by laboratory permission, without a demo badge", () => {
    expect(hrefs(["patient.read"])).not.toContain("/laboratory");
    expect(navigationForPermissions(["lab.order.read"]).find((i) => i.href === "/laboratory")?.badge).toBeUndefined();
  });

  it("shows the API-backed appointments and queue by their clinic permissions, without a demo badge", () => {
    expect(hrefs(["patient.read"])).not.toContain("/queue");
    const nav = navigationForPermissions(["appointment.read", "clinic.queue.read"]);
    expect(nav.find((i) => i.href === "/appointments")?.badge).toBeUndefined();
    expect(nav.find((i) => i.href === "/queue")?.badge).toBeUndefined();
  });

  it("lists consultations, care plans and referrals separately, each by its own permission", () => {
    expect(hrefs(["patient.read"])).not.toContain("/clinic/encounters");
    expect(hrefs(["encounter.read"])).toEqual(expect.arrayContaining(["/clinic/encounters", "/clinic/referrals"]));
    expect(hrefs(["encounter.read"])).not.toContain("/clinic/care-plans");
    expect(hrefs(["care-plan.read"])).toContain("/clinic/care-plans");
  });

  it("groups the sidebar and pins Settings and Help to the bottom", () => {
    const nav = navigationForPermissions(["patient.search", "encounter.read", "billing.charge.read", "crm.read", "clinic.queue.read", "clinic.configure"]);
    const group = (href: string) => nav.find((i) => i.href === href)?.group;
    expect(group("/queue")).toBe("Today");
    expect(group("/patients")).toBe("Patients");
    expect(group("/clinic/encounters")).toBe("Clinical");
    expect(group("/billing")).toBe("Operations");
    expect(group("/outreach")).toBe("Engagement");
    expect(nav.filter((i) => i.placement === "footer").map((i) => i.href)).toEqual(["/admin", "/help"]);
  });

  it("shows Settings only when one of its pages is open to the user", () => {
    expect(hrefs(["patient.read"])).not.toContain("/admin");
    // The staff list needs user.read; managing users without reading them would bounce.
    expect(hrefs(["user.manage"])).not.toContain("/admin");
    expect(hrefs(["integration.exchange.manage"])).toContain("/admin");
    expect(hrefs(["clinic.configure"])).toContain("/admin");
    // Settings is current on every settings page, wherever it lives.
    const settings = navigationForPermissions(["clinic.configure"]).find((i) => i.href === "/admin");
    expect(settings?.match?.("/clinic/procedures")).toBe(true);
    expect(settings?.match?.("/admin/users/abc")).toBe(true);
    expect(settings?.match?.("/clinic/encounters")).toBe(false);
  });

  it("keeps a module current on the pages it owns, and not on its settings page", () => {
    const nav = navigationForPermissions(["appointment.read", "dental.record.read", "encounter.read"]);
    const appointments = nav.find((i) => i.href === "/appointments");
    expect(appointments?.match?.("/doctors")).toBe(false);
    expect(nav.find((i) => i.href === "/doctors")?.match).toBeUndefined();
    expect(hrefs(["appointment.read"])).toContain("/doctors");
    expect(appointments?.match?.("/appointments/waitlist")).toBe(true);
    expect(appointments?.match?.("/appointments/visit-types")).toBe(false);
    expect(nav.find((i) => i.href === "/dental")?.match?.("/dental/settings")).toBe(false);
    expect(nav.find((i) => i.href === "/clinic/encounters")?.match?.("/clinic/prescriptions")).toBe(true);
    expect(nav.find((i) => i.href === "/clinic/referrals")?.match?.("/clinic/referrals/settings")).toBe(false);
  });

  it("drops demo role filters from items", () => {
    const consultations = navigationForPermissions(["encounter.read"]).find((i) => i.href === "/clinic/encounters");
    expect(consultations && "roles" in consultations).toBe(false);
  });

  it("shows record imports only to import reviewers", () => {
    expect(hrefs(["patient.search", "clinical.read"])).not.toContain("/records");
    expect(hrefs(["interop.fhir.import.review"])).toContain("/records");
  });
});

describe("nothing a user could reach before is lost", () => {
  // Every address the sidebar used to list (modules and their sub-items) must still be reachable by someone who held the
  // permissions for it: as a sidebar entry, a module tab or a settings page.
  const OLD_ADDRESSES = [
    "/patients",
    "/calendar",
    "/appointments",
    "/doctors",
    "/queue",
    "/clinic/encounters",
    "/clinic/care-plans",
    "/clinic/vaccines",
    "/clinic/procedures",
    "/clinic/coding-systems",
    "/clinic/prescriptions",
    "/clinic/referrals",
    "/clinic/signatures",
    "/laboratory/worklist",
    "/laboratory/send-outs",
    "/laboratory/critical",
    "/laboratory/instrument-results",
    "/laboratory/catalog",
    "/laboratory/qc",
    "/laboratory/instruments",
    "/laboratory/reagents",
    "/laboratory/temperatures",
    "/laboratory/nonconformances",
    "/laboratory/eqa",
    "/laboratory/competency",
    "/laboratory/licence",
    "/dental",
    "/dental/settings",
    "/telemedicine",
    "/billing",
    "/pharmacy",
    "/inventory",
    "/messages",
    "/communications",
    "/outreach",
    "/management",
    "/management/reports",
    "/reporting",
    "/records/requests",
    "/records/imports",
    "/records/retention",
    "/records/integrity",
    "/admin/organization",
    "/admin/users",
    "/admin/security",
    "/admin/roles",
    "/admin/facilities",
    "/admin/service-points",
    "/admin/audit",
    "/admin/integrations",
    "/admin/compliance",
    "/admin/consent-wording",
    "/admin/privacy",
    "/admin/patient-qr",
    "/help",
  ];
  const EVERYTHING = [
    "patient.search",
    "calendar.read",
    "appointment.read",
    "clinic.queue.read",
    "encounter.read",
    "care-plan.read",
    "immunization.read",
    "prescription.read",
    "clinic.configure",
    "lab.order.read",
    "lab.result.read",
    "lab.qc.read",
    "dental.record.read",
    "telemedicine.read",
    "billing.charge.read",
    "billing.report.read",
    "billing.pricelist.manage",
    "prescription.dispense",
    "inventory.read",
    "inventory.catalog.manage",
    "inventory.valuation.read",
    "inventory.controlled-register.read",
    "patient.message.read",
    "notification.read",
    "crm.read",
    "management.dashboard.read",
    "doh.report.manage",
    "doh.settings.manage",
    "interop.fhir.import.review",
    "patient.records-request.manage",
    "document.retention.manage",
    "document.integrity.manage",
    "organization.read",
    "user.read",
    "audit.read",
    "integration.exchange.manage",
    "compliance.review.manage",
    "consent.wording.manage",
    "privacy.incident.manage",
    "patient.qr.manage",
  ];

  it("keeps every former address in the navigation, a module's tabs or Settings", () => {
    const reachable = new Set<string>();
    for (const item of navigationForPermissions(EVERYTHING)) reachable.add(item.href);
    for (const group of settingsForPermissions(EVERYTHING)) for (const page of group.pages) reachable.add(page.href);
    for (const path of ["/laboratory/worklist", "/billing", "/inventory", "/clinic/encounters", "/appointments", "/records/requests", "/management"]) {
      for (const tab of moduleTabsFor(path, EVERYTHING)?.tabs ?? []) reachable.add(tab.href);
    }
    expect(OLD_ADDRESSES.filter((href) => !reachable.has(href))).toEqual([]);
  });
});

describe("isDemoPath", () => {
  it("flags fixture-backed modules and previews, not API-backed pages", () => {
    expect(isDemoPath("/dental")).toBe(false);
    expect(isDemoPath("/laboratory/worklist")).toBe(false);
    expect(isDemoPath("/preview/patient-360")).toBe(true);
    expect(isDemoPath("/patients/abc")).toBe(false);
    expect(isDemoPath("/")).toBe(false);
    expect(isDemoPath("/queue")).toBe(false);
    expect(isDemoPath("/clinic/encounters/abc")).toBe(false);
    expect(isDemoPath("/appointments/new")).toBe(false);
  });

  it("shows billing to users with billing permission", () => {
    expect(hrefs(["patient.read"])).not.toContain("/billing");
    expect(navigationForPermissions(["billing.charge.read"]).find((i) => i.href === "/billing")?.badge).toBeUndefined();
  });
});

describe("settingsForPermissions", () => {
  const pages = (permissions: string[]) => settingsForPermissions(permissions).flatMap((g) => g.pages.map((p) => p.href));

  it("offers only the settings pages the user can open, grouped", () => {
    expect(pages([])).toEqual([]);
    expect(pages(["integration.exchange.manage"])).toEqual(["/admin/integrations"]);
    expect(pages(["audit.read"])).toEqual(["/admin/audit"]);
    // Service points are clinic configuration; a clinic administrator without user.read still reaches them.
    expect(pages(["clinic.configure"])).toEqual(["/clinic/referrals/settings", "/clinic/signatures", "/admin/service-points"]);
    expect(pages(["user.read", "organization.read"])).toEqual(["/admin/users", "/admin/roles", "/admin/facilities", "/admin/organization", "/admin/security"]);
    expect(settingsForPermissions(["lab.order.read"]).map((g) => g.label)).toEqual(["Laboratory"]);
  });

  it("recognizes settings pages and their sub-pages, not the modules around them", () => {
    for (const path of [
      "/admin",
      "/admin/users/abc",
      "/clinic/procedures",
      "/billing/settings",
      "/laboratory/catalog",
      "/records/requests/settings",
      "/appointments/schedules",
    ]) {
      expect(isSettingsPath(path)).toBe(true);
    }
    for (const path of [
      "/",
      "/billing",
      "/billing/invoices",
      "/clinic/encounters/abc",
      "/records/requests",
      "/laboratory/worklist",
      "/dental/patients/abc",
      "/appointments",
    ]) {
      expect(isSettingsPath(path)).toBe(false);
    }
  });
});

describe("moduleTabsFor", () => {
  const badges: StaffBadges = { messagesAwaiting: 0, messagesOverdue: 0, criticalResults: 2, recordsRequests: 1, caseReports: null };

  it("offers a module's tabs by permission, with counts that need action marked", () => {
    const lab = moduleTabsFor("/laboratory/worklist", ["lab.order.read", "lab.result.read"], badges);
    expect(lab?.label).toBe("Laboratory sections");
    expect(lab?.tabs.map((t) => t.href)).toEqual(["/laboratory/worklist", "/laboratory/critical", "/laboratory/send-outs", "/laboratory/instrument-results"]);
    expect(lab?.tabs.find((t) => t.href === "/laboratory/critical")).toMatchObject({ count: 2, alert: true });
    expect(lab?.tabs.find((t) => t.href === "/laboratory/worklist")?.count).toBeUndefined();
    // A phlebotomist: the worklist and send-outs only.
    expect(moduleTabsFor("/laboratory/send-outs", ["lab.order.read"])?.tabs.map((t) => t.href)).toEqual(["/laboratory/worklist", "/laboratory/send-outs"]);
  });

  it("shows no tabs outside a module, on settings pages, or when there is nothing to switch between", () => {
    expect(moduleTabsFor("/patients/abc", ["patient.search"])).toBeNull();
    expect(moduleTabsFor("/billing/settings", ["billing.charge.read", "billing.report.read"])).toBeNull();
    expect(moduleTabsFor("/dental", ["dental.record.read"])).toBeNull();
    expect(moduleTabsFor("/billing", ["billing.charge.read"])).toMatchObject({ tabs: [{ href: "/billing" }, { href: "/billing/invoices" }] });
    expect(moduleTabsFor("/inventory/valuation", ["inventory.read"])?.tabs.map((t) => t.href)).not.toContain("/inventory/valuation");
  });

  it("keeps the module's tabs on its detail pages", () => {
    expect(moduleTabsFor("/billing/invoices/abc", ["billing.charge.read"])?.tabs.map((t) => t.href)).toContain("/billing/invoices");
    expect(moduleTabsFor("/doctors", ["appointment.read"])?.tabs.map((t) => t.href)).toContain("/doctors");
  });
});

describe("withBadgeCounts", () => {
  const items = [
    { label: "Messages", href: "/messages" },
    { label: "Laboratory", href: "/laboratory" },
    { label: "Records", href: "/records" },
    { label: "Reporting", href: "/reporting" },
    { label: "Billing", href: "/billing" },
  ];

  it("adds a count only where there is something waiting the user may see", () => {
    const counted = withBadgeCounts(items, { messagesAwaiting: 3, messagesOverdue: 1, criticalResults: 0, recordsRequests: null, caseReports: 2 });
    expect(counted.map((i) => i.count ?? null)).toEqual([3, null, null, 2, null]);
  });

  it("marks the laboratory's critical results as needing attention", () => {
    const counted = withBadgeCounts(items, { messagesAwaiting: 0, messagesOverdue: 0, criticalResults: 2, recordsRequests: null, caseReports: null });
    expect(counted.find((i) => i.href === "/laboratory")).toMatchObject({ count: 2, countAlert: true });
  });

  it("leaves the navigation alone without counts", () => {
    expect(withBadgeCounts(items, null)).toBe(items);
  });
});
