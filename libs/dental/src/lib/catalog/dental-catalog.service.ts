import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, type DbExecutor, NotFoundError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { createProcedureTypeSchema, updateProcedureTypeSchema } from "../dental.dto";
import { dentalFacilitySetting, dentalProcedureType, type DentalProcedureTypeRecord, type Notation } from "../dental.schema";
import { assertVersion, found, strip } from "../dental-support";

/**
 * The organization's dental procedure catalog (its own codes: no national dental procedure coding is assumed) and
 * each facility's tooth notation for display (storage is always FDI).
 */
@Injectable()
export class DentalCatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  async notation(organizationId: string, facilityId: string | null | undefined): Promise<Notation> {
    return facilityId ? this.notationIn(this.db, organizationId, facilityId) : "fdi";
  }

  async setNotation(actor: Actor, facilityId: string, notation: Notation) {
    // Throws NotFound for a facility of another organization.
    await this.organizations.getFacility(actor.organizationId, facilityId);
    return this.db.transaction(async (tx) => {
      const previous = await this.notationIn(tx, actor.organizationId, facilityId);
      await tx
        .insert(dentalFacilitySetting)
        .values({ facilityId, organizationId: actor.organizationId, notation, updatedBy: actor.userId })
        .onConflictDoUpdate({ target: dentalFacilitySetting.facilityId, set: { notation, updatedBy: actor.userId, updatedAt: new Date() } });
      await this.audit.record(tx, actor, {
        action: "dental.settings.notation",
        resourceType: "facility",
        resourceId: facilityId,
        changes: { notation: { from: previous, to: notation } },
      });
      return { facilityId, notation };
    });
  }

  async procedureTypes(organizationId: string) {
    const rows = await this.db
      .select()
      .from(dentalProcedureType)
      .where(eq(dentalProcedureType.organizationId, organizationId))
      .orderBy(asc(dentalProcedureType.name));
    return rows.map(strip);
  }

  async createProcedureType(actor: Actor, input: z.infer<typeof createProcedureTypeSchema>) {
    if (input.site === "mouth" && input.chartEffect)
      throw new BusinessRuleError("A whole-mouth procedure cannot change a tooth on the chart", "invalid_chart_effect");
    const surfaceEffect = input.chartEffect === "restoration" || input.chartEffect === "sealant";
    if (input.chartEffect && surfaceEffect !== (input.site === "surface")) {
      throw new BusinessRuleError(
        surfaceEffect ? "Restorations and sealants are recorded on surfaces" : "This chart effect applies to the whole tooth",
        "invalid_chart_effect",
      );
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(dentalProcedureType)
        .values({ organizationId: actor.organizationId, ...input })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictError(`A procedure with code ${input.code} exists`, undefined, "procedure_code_exists");
      await this.audit.record(tx, actor, {
        action: "dental.procedure-type.create",
        resourceType: "dental_procedure_type",
        resourceId: row.id,
        metadata: { code: row.code, site: row.site, chartEffect: row.chartEffect },
      });
      return strip(row);
    });
  }

  /** Name and status. Code, site and chart effect are fixed once created (recorded procedures depend on them). */
  async updateProcedureType(actor: Actor, id: string, input: z.infer<typeof updateProcedureTypeSchema>) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(dentalProcedureType)
        .where(and(eq(dentalProcedureType.organizationId, actor.organizationId), eq(dentalProcedureType.id, id)))
        .for("update");
      const type = found(current, "Procedure");
      assertVersion(type.version, input.version, "Procedure");
      const { version: _v, ...changes } = input;
      const [row] = (await tx
        .update(dentalProcedureType)
        .set({ ...changes, updatedAt: new Date(), version: type.version + 1 })
        .where(eq(dentalProcedureType.id, id))
        .returning()) as [DentalProcedureTypeRecord];
      await this.audit.record(tx, actor, {
        action: "dental.procedure-type.update",
        resourceType: "dental_procedure_type",
        resourceId: id,
        changes: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, { from: type[k as keyof DentalProcedureTypeRecord], to: v }])),
      });
      return strip(row);
    });
  }

  /** An active procedure type of the organization (for new plan items and procedures). */
  async requireActive(executor: DbExecutor, organizationId: string, id: string): Promise<DentalProcedureTypeRecord> {
    const [row] = await executor
      .select()
      .from(dentalProcedureType)
      .where(and(eq(dentalProcedureType.organizationId, organizationId), eq(dentalProcedureType.id, id)));
    if (!row) throw new NotFoundError("Procedure");
    if (row.status !== "active") throw new BusinessRuleError(`${row.name} is inactive`, "procedure_type_inactive");
    return row;
  }

  async byIds(executor: DbExecutor, organizationId: string, ids: string[]): Promise<Map<string, DentalProcedureTypeRecord>> {
    if (!ids.length) return new Map();
    const rows = await executor
      .select()
      .from(dentalProcedureType)
      .where(and(eq(dentalProcedureType.organizationId, organizationId), inArray(dentalProcedureType.id, [...new Set(ids)])));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async notationIn(executor: DbExecutor, organizationId: string, facilityId: string): Promise<Notation> {
    const [row] = await executor
      .select({ notation: dentalFacilitySetting.notation })
      .from(dentalFacilitySetting)
      .where(and(eq(dentalFacilitySetting.organizationId, organizationId), eq(dentalFacilitySetting.facilityId, facilityId)));
    return row?.notation ?? "fdi";
  }
}
