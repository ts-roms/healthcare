import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, type DbExecutor, NotFoundError, VersionConflictError } from "@healthcare/core";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  type createDepartmentSchema,
  type createFacilitySchema,
  type createOrganizationSchema,
  normalizeContactNumber,
  type updateFacilitySchema,
  type updateOrganizationSchema,
} from "./organization.dto";
import {
  department,
  type DepartmentRecord,
  facility,
  type FacilityRecord,
  organization,
  type OrganizationRecord,
  type OrganizationStatus,
  organizationStatusChange,
  type OrganizationStatusChangeRecord,
} from "./organization.schema";

/** One organization as the platform console lists it (migration 0151): no patient data. */
export interface PlatformOrganizationRow {
  id: string;
  code: string;
  name: string;
  status: OrganizationStatus;
  createdAt: Date;
  facilitiesActive: number;
  facilitiesTotal: number;
}

const FACILITY_AUDITED_FIELDS = [
  "name",
  "facilityType",
  "addressLine",
  "barangay",
  "cityMunicipality",
  "province",
  "region",
  "postalCode",
  "contactNumber",
  "email",
  "licenseNumber",
  "status",
] as const;

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async createOrganization(actor: Actor, input: z.infer<typeof createOrganizationSchema>): Promise<OrganizationRecord> {
    return this.db.transaction((tx) => this.insertOrganization(tx, actor, input));
  }

  /** Creates the organization in the caller's transaction, audited in the new organization's own trail. */
  async insertOrganization(tx: DbExecutor, actor: Actor, input: z.infer<typeof createOrganizationSchema>): Promise<OrganizationRecord> {
    const existing = await tx.select({ id: organization.id }).from(organization).where(eq(organization.code, input.code));
    if (existing.length > 0) throw new ConflictError(`Organization code "${input.code}" is already in use`, undefined, "organization_code_taken");
    const [created] = await tx.insert(organization).values(input).returning();
    if (!created) throw new Error("Insert returned no row");
    await this.audit.record(
      tx,
      { ...actor, organizationId: created.id },
      {
        action: "organization.create",
        resourceType: "organization",
        resourceId: created.id,
        metadata: { code: created.code },
      },
    );
    return created;
  }

  /** A new organization's first facility, in the caller's transaction (platform console), audited in that organization. */
  async insertFirstFacility(tx: DbExecutor, actor: Actor, organizationId: string, input: z.infer<typeof createFacilitySchema>): Promise<FacilityRecord> {
    const [created] = await tx
      .insert(facility)
      .values({ ...input, contactNumber: normalizeContactNumber(input.contactNumber), organizationId })
      .returning();
    if (!created) throw new Error("Insert returned no row");
    await this.audit.record(
      tx,
      { ...actor, organizationId },
      { action: "facility.create", resourceType: "facility", resourceId: created.id, metadata: { code: created.code, facilityType: created.facilityType } },
    );
    return created;
  }

  /**
   * Every organization with its facility counts, for the platform console (the caller crosses organizations on purpose,
   * under the platform scope). Names and counts only.
   */
  async platformOrganizations(): Promise<PlatformOrganizationRow[]> {
    const rows = await this.db
      .select({
        id: organization.id,
        code: organization.code,
        name: organization.name,
        status: organization.status,
        createdAt: organization.createdAt,
        facilitiesActive: sql<number>`count(${facility.id}) FILTER (WHERE ${facility.status} = 'active')::int`,
        facilitiesTotal: sql<number>`count(${facility.id})::int`,
      })
      .from(organization)
      .leftJoin(facility, eq(facility.organizationId, organization.id))
      .groupBy(organization.id)
      .orderBy(asc(organization.name));
    return rows;
  }

  /** The organization's status changes, newest first (platform console). */
  statusHistory(organizationId: string): Promise<OrganizationStatusChangeRecord[]> {
    return this.db
      .select()
      .from(organizationStatusChange)
      .where(eq(organizationStatusChange.organizationId, organizationId))
      .orderBy(desc(organizationStatusChange.changedAt));
  }

  /**
   * Suspends or reactivates an organization (platform administrators), in the caller's transaction so the sessions
   * ending with a suspension end with it. The change is kept with its reason (migration 0151) and audited in the
   * organization's own trail. Archiving is not offered.
   */
  async changeStatus(
    tx: DbExecutor,
    actor: Actor,
    organizationId: string,
    input: { status: "active" | "suspended"; reason: string; version: number },
  ): Promise<OrganizationRecord> {
    const [before] = await tx.select().from(organization).where(eq(organization.id, organizationId)).for("update");
    if (!before) throw new NotFoundError("Organization");
    if (before.version !== input.version) throw new VersionConflictError("Organization", input.version);
    if (before.status === input.status) {
      throw new BusinessRuleError(`The organization is already ${input.status}`, "organization_status_unchanged");
    }
    if (before.status === "archived") throw new BusinessRuleError("An archived organization cannot be changed here", "organization_archived");
    const [updated] = await tx
      .update(organization)
      .set({ status: input.status, updatedAt: new Date(), version: sql`${organization.version} + 1` })
      .where(eq(organization.id, organizationId))
      .returning();
    if (!updated) throw new NotFoundError("Organization");
    await tx.insert(organizationStatusChange).values({
      organizationId,
      fromStatus: before.status,
      toStatus: input.status,
      reason: input.reason,
      changedBy: actor.userId,
    });
    await this.audit.record(
      tx,
      { ...actor, organizationId },
      {
        action: input.status === "suspended" ? "organization.suspend" : "organization.reactivate",
        resourceType: "organization",
        resourceId: organizationId,
        reason: input.reason,
        changes: { status: { from: before.status, to: input.status } },
      },
    );
    return updated;
  }

  async getOrganization(organizationId: string): Promise<OrganizationRecord> {
    const [row] = await this.db.select().from(organization).where(eq(organization.id, organizationId));
    if (!row) throw new NotFoundError("Organization");
    return row;
  }

  async updateOrganization(actor: Actor, input: z.infer<typeof updateOrganizationSchema>): Promise<OrganizationRecord> {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(organization).where(eq(organization.id, actor.organizationId)).for("update");
      if (!before) throw new NotFoundError("Organization");
      if (before.version !== version) throw new VersionConflictError("Organization", version);
      const [updated] = await tx
        .update(organization)
        .set({ ...changes, updatedAt: new Date(), version: sql`${organization.version} + 1` })
        .where(eq(organization.id, actor.organizationId))
        .returning();
      if (!updated) throw new NotFoundError("Organization");
      await this.audit.record(tx, actor, {
        action: "organization.update",
        resourceType: "organization",
        resourceId: actor.organizationId,
        changes: diffChanges(before, changes, ["name"] as const),
      });
      return updated;
    });
  }

  listFacilities(organizationId: string): Promise<FacilityRecord[]> {
    return this.db.select().from(facility).where(eq(facility.organizationId, organizationId)).orderBy(asc(facility.name));
  }

  /** Returns the facility only if it belongs to the organization. */
  async findFacility(organizationId: string, facilityId: string): Promise<FacilityRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(facility)
      .where(and(eq(facility.organizationId, organizationId), eq(facility.id, facilityId)));
    return row;
  }

  /** Returns the department only if it belongs to the facility and organization. */
  async findDepartment(organizationId: string, facilityId: string, departmentId: string): Promise<DepartmentRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(department)
      .where(and(eq(department.organizationId, organizationId), eq(department.facilityId, facilityId), eq(department.id, departmentId)));
    return row;
  }

  async getFacility(organizationId: string, facilityId: string): Promise<FacilityRecord> {
    const row = await this.findFacility(organizationId, facilityId);
    if (!row) throw new NotFoundError("Facility");
    return row;
  }

  async createFacility(actor: Actor, input: z.infer<typeof createFacilitySchema>): Promise<FacilityRecord> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(facility)
        .values({ ...input, contactNumber: normalizeContactNumber(input.contactNumber), organizationId: actor.organizationId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Facility code "${input.code}" is already in use`);
      await this.audit.record(tx, actor, {
        action: "facility.create",
        resourceType: "facility",
        resourceId: created.id,
        metadata: { code: created.code, facilityType: created.facilityType },
      });
      return created;
    });
  }

  async updateFacility(actor: Actor, facilityId: string, input: z.infer<typeof updateFacilitySchema>): Promise<FacilityRecord> {
    const { version, ...changes } = input;
    if ("contactNumber" in changes) changes.contactNumber = normalizeContactNumber(changes.contactNumber);
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(facility)
        .where(and(eq(facility.organizationId, actor.organizationId), eq(facility.id, facilityId)))
        .for("update");
      if (!before) throw new NotFoundError("Facility");
      if (before.version !== version) throw new VersionConflictError("Facility", version);
      const [updated] = await tx
        .update(facility)
        .set({ ...changes, updatedAt: new Date(), version: sql`${facility.version} + 1` })
        .where(eq(facility.id, facilityId))
        .returning();
      if (!updated) throw new NotFoundError("Facility");
      await this.audit.record(tx, actor, {
        action: "facility.update",
        resourceType: "facility",
        resourceId: facilityId,
        changes: diffChanges(before, changes, FACILITY_AUDITED_FIELDS),
      });
      return updated;
    });
  }

  async listDepartments(organizationId: string, facilityId: string): Promise<DepartmentRecord[]> {
    await this.getFacility(organizationId, facilityId);
    return this.db
      .select()
      .from(department)
      .where(and(eq(department.organizationId, organizationId), eq(department.facilityId, facilityId)))
      .orderBy(asc(department.name));
  }

  async createDepartment(actor: Actor, facilityId: string, input: z.infer<typeof createDepartmentSchema>): Promise<DepartmentRecord> {
    await this.getFacility(actor.organizationId, facilityId);
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(department)
        .values({ ...input, organizationId: actor.organizationId, facilityId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Department code "${input.code}" is already in use at this facility`);
      await this.audit.record(tx, actor, {
        action: "department.create",
        resourceType: "department",
        resourceId: created.id,
        metadata: { facilityId, code: created.code },
      });
      return created;
    });
  }
}
