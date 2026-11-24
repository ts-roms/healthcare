import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { UsersService } from "@healthcare/auth";
import { type Actor, asPlatform, BusinessRuleError, DATABASE, type Database, NotFoundError } from "@healthcare/core";
import { OrganizationService, type OrganizationStatus } from "@healthcare/organization";
import { PatientReportingQueries, PortalAccountService } from "@healthcare/patient";
import type { z } from "zod";
import { type PatientCount, suppressCount } from "../management-dashboard/management-dashboard.rules";
import type { createTenantSchema, tenantStatusSchema } from "./platform-tenants.dto";

/** One tenant as the platform console lists it: operational figures, never a patient's data. */
export interface TenantSummary {
  id: string;
  code: string;
  name: string;
  status: OrganizationStatus;
  createdAt: Date;
  facilities: { active: number; total: number };
  activeStaff: number;
  /** Patient counts from 1 to 4 are shown as "<5" (management dashboard rule). */
  patients: PatientCount;
  myHealthAccounts: PatientCount;
  lastStaffSignInAt: Date | null;
}

export interface TenantDetail extends TenantSummary {
  version: number;
  /** The organization the platform administrator is signed in to (it cannot be suspended from inside). */
  isCurrentOrganization: boolean;
  facilityList: Array<{
    id: string;
    code: string;
    name: string;
    facilityType: string;
    cityMunicipality: string | null;
    province: string | null;
    status: string;
  }>;
  administrators: Awaited<ReturnType<UsersService["organizationAdministrators"]>>;
  statusHistory: Array<{ id: string; fromStatus: OrganizationStatus; toStatus: OrganizationStatus; reason: string; changedAt: Date; changedBy: string }>;
}

/**
 * The platform console's tenants (docs/architecture/platform-console.md): composed here from each domain's own
 * figures, across organizations on purpose under the platform scope, for platform administrators only (with two-step
 * verification, AccessGuard). Every view and change is audited — a view and a change in the tenant's own trail.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
    private readonly users: UsersService,
    private readonly patients: PatientReportingQueries,
    private readonly portalAccounts: PortalAccountService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor): Promise<{ items: TenantSummary[]; totals: Record<"organizations" | "active" | "suspended", number> }> {
    const { items } = await asPlatform("platform console: tenant list", () => this.listQuiet());
    await this.audit.recordStandalone(actor, { action: "platform.tenant.list", resourceType: "organization", metadata: { count: items.length } });
    return {
      items,
      totals: {
        organizations: items.length,
        active: items.filter((i) => i.status === "active").length,
        suspended: items.filter((i) => i.status === "suspended").length,
      },
    };
  }

  async get(actor: Actor, organizationId: string): Promise<TenantDetail> {
    const detail = await asPlatform("platform console: one tenant", async () => {
      const { items } = await this.listQuiet();
      const summary = items.find((i) => i.id === organizationId);
      if (!summary) throw new NotFoundError("Organization");
      const organization = await this.organizations.getOrganization(organizationId);
      const facilities = await this.organizations.listFacilities(organizationId);
      const administrators = await this.users.organizationAdministrators(organizationId);
      const history = await this.organizations.statusHistory(organizationId);
      const names = await this.users.accountDisplayNames([...new Set(history.map((h) => h.changedBy))]);
      await this.audit.recordStandalone(
        { ...actor, organizationId },
        { action: "platform.tenant.view", resourceType: "organization", resourceId: organizationId },
      );
      return {
        ...summary,
        version: organization.version,
        isCurrentOrganization: organizationId === actor.organizationId,
        facilityList: facilities.map((f) => ({
          id: f.id,
          code: f.code,
          name: f.name,
          facilityType: f.facilityType,
          cityMunicipality: f.cityMunicipality,
          province: f.province,
          status: f.status,
        })),
        administrators,
        statusHistory: history.map((h) => ({
          id: h.id,
          fromStatus: h.fromStatus,
          toStatus: h.toStatus,
          reason: h.reason,
          changedAt: h.changedAt,
          changedBy: names.get(h.changedBy) ?? "Platform administrator",
        })),
      };
    });
    return detail;
  }

  /**
   * Creates a tenant in one transaction: the organization, its first facility and its first administrator (a new
   * account gets the temporary password given here, to be replaced at the first sign-in; an existing staff account is
   * only added). Everything is audited in the new organization's trail.
   */
  async create(actor: Actor, input: z.infer<typeof createTenantSchema>): Promise<TenantDetail> {
    const { facility, administrator, ...organization } = input;
    // Screened against known breaches before the transaction (a network call), as for every new password.
    const passwordHash = await asPlatform("platform console: is the administrator's email known", () =>
      this.users.newAccountPasswordHash(administrator.email, administrator.temporaryPassword),
    );
    const organizationId = await asPlatform("platform console: create a tenant", () =>
      this.db.transaction(async (tx) => {
        const created = await this.organizations.insertOrganization(tx, actor, organization);
        await this.organizations.insertFirstFacility(tx, actor, created.id, facility);
        await this.users.addOrganizationAdministrator(tx, actor, created.id, {
          email: administrator.email,
          displayName: administrator.displayName,
          passwordHash,
        });
        return created.id;
      }),
    );
    return this.get(actor, organizationId);
  }

  /**
   * Suspends or reactivates a tenant. A suspension ends every staff and MyHealth session of the organization in the
   * same transaction; sign-in and every request are refused while it lasts (organization.status). The organization
   * the administrator is signed in to cannot be suspended from inside it.
   */
  async changeStatus(actor: Actor, organizationId: string, input: z.infer<typeof tenantStatusSchema>): Promise<TenantDetail> {
    if (input.status === "suspended" && organizationId === actor.organizationId) {
      throw new BusinessRuleError("Sign in to another organization to suspend the one you are signed in to", "cannot_suspend_current_organization");
    }
    await asPlatform("platform console: change a tenant's status", () =>
      this.db.transaction(async (tx) => {
        await this.organizations.changeStatus(tx, actor, organizationId, input);
        if (input.status === "suspended") {
          await this.users.endOrganizationSessions(tx, organizationId);
          await this.portalAccounts.revokeAllForOrganization(tx, organizationId);
        }
      }),
    );
    return this.get(actor, organizationId);
  }

  /** The tenants without an audit event (the list and the detail view record their own). */
  private async listQuiet(): Promise<{ items: TenantSummary[] }> {
    const [organizations, members, patientFigures] = await Promise.all([
      this.organizations.platformOrganizations(),
      this.users.platformMemberFigures(),
      this.patients.platformFigures(),
    ]);
    return {
      items: organizations.map((o): TenantSummary => {
        const m = members.get(o.id);
        const p = patientFigures.get(o.id);
        return {
          id: o.id,
          code: o.code,
          name: o.name,
          status: o.status,
          createdAt: o.createdAt,
          facilities: { active: o.facilitiesActive, total: o.facilitiesTotal },
          activeStaff: m?.activeMembers ?? 0,
          patients: suppressCount(p?.patients ?? 0),
          myHealthAccounts: suppressCount(p?.myHealthAccounts ?? 0),
          lastStaffSignInAt: m?.lastStaffSignInAt ?? null,
        };
      }),
    };
  }
}
