import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { type Actor, ConflictError, DATABASE, type Database, NotFoundError, VersionConflictError } from "@healthcare/core";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  type createDepartmentSchema,
  type createFacilitySchema,
  type createOrganizationSchema,
  normalizeContactNumber,
  type updateFacilitySchema,
} from "./organization.dto";
import { department, type DepartmentRecord, facility, type FacilityRecord, organization, type OrganizationRecord } from "./organization.schema";

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
    return this.db.transaction(async (tx) => {
      const existing = await tx.select({ id: organization.id }).from(organization).where(eq(organization.code, input.code));
      if (existing.length > 0) throw new ConflictError(`Organization code "${input.code}" is already in use`);
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
    });
  }

  async getOrganization(organizationId: string): Promise<OrganizationRecord> {
    const [row] = await this.db.select().from(organization).where(eq(organization.id, organizationId));
    if (!row) throw new NotFoundError("Organization");
    return row;
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
