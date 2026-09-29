import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, asPgError, BusinessRuleError, ConflictError, DATABASE, type Database, DomainEventPublisher, localDate } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { DentalCatalogService } from "../catalog/dental-catalog.service";
import { DentalChartService } from "../chart/dental-chart.service";
import type { recordProcedureSchema } from "../dental.dto";
import { applyChartEffect, normalizeSurfaces, procedureLabel, procedureSiteIssues } from "../dental.rules";
import { dentalProcedure, type DentalProcedureRecord, dentalProcedureType } from "../dental.schema";
import { found, rejectIssues, requireDentist, requireOpenEncounter, strip } from "../dental-support";
import { DentalPlanService } from "../plans/dental-plan.service";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";

/** A performed procedure as billing sees it (apps/api adapters): what to charge, for whom, where and when. */
export interface BillableDentalProcedure {
  id: string;
  patientId: string;
  facilityId: string;
  procedureCode: string;
  description: string;
  /** Local service date (YYYY-MM-DD, facility time). */
  serviceDate: string;
  /** Surfaces treated (0 when recorded against the tooth or the whole mouth). */
  surfaceCount: number;
}

/**
 * Performed dental procedures, recorded during the patient's encounter against a tooth and surfaces. A procedure with
 * a chart effect appends the tooth's new state; one that carries out a plan item completes it. Billing captures the
 * charge from `DentalProcedurePerformed` — dentistry does not price anything.
 */
@Injectable()
export class DentalProcedureService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: DentalCatalogService,
    private readonly chart: DentalChartService,
    private readonly plans: DentalPlanService,
    private readonly organizations: OrganizationService,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
  ) {}

  async record(actor: Actor, patientId: string, input: z.infer<typeof recordProcedureSchema>) {
    const dentist = await requireDentist(this.context, actor);
    const encounter = await requireOpenEncounter(this.context, actor, input.encounterId, patientId);
    try {
      return await this.db.transaction(async (tx) => {
        const type = await this.catalog.requireActive(tx, actor.organizationId, input.procedureTypeId);
        rejectIssues(
          { site: procedureSiteIssues(type.site, input.tooth, input.surfaces) },
          "The procedure is not recorded correctly",
          "invalid_procedure_site",
        );
        const surfaces = normalizeSurfaces(input.surfaces);
        const [created] = await tx
          .insert(dentalProcedure)
          .values({
            organizationId: actor.organizationId,
            facilityId: encounter.facilityId,
            patientId,
            encounterId: encounter.id,
            practitionerId: dentist.id,
            procedureTypeId: type.id,
            tooth: input.tooth ?? null,
            surfaces,
            notes: input.notes || null,
            planItemId: input.planItemId ?? null,
            recordedBy: actor.userId,
          })
          .returning();
        const procedure = found(created, "Procedure");
        if (procedure.planItemId) await this.plans.completeItem(tx, procedure);
        if (type.chartEffect && procedure.tooth) {
          const [current] = await this.chart.chart(actor.organizationId, patientId, tx, [procedure.tooth]);
          await this.chart.appendState(tx, {
            organizationId: actor.organizationId,
            patientId,
            tooth: procedure.tooth,
            source: { type: "procedure", id: procedure.id },
            findings: applyChartEffect(current?.findings ?? [], type.chartEffect, surfaces),
            recordedBy: actor.userId,
          });
          await this.chart.chartUpdated(tx, actor.organizationId, patientId, procedure.facilityId, "procedure", procedure.id, [procedure.tooth]);
        }
        await this.audit.record(tx, actor, {
          action: "dental.procedure.record",
          resourceType: "dental_procedure",
          resourceId: procedure.id,
          patientId,
          metadata: { encounterId: encounter.id, code: type.code, tooth: procedure.tooth, surfaces, planItemId: procedure.planItemId },
        });
        await this.events.record(tx, {
          type: "DentalProcedurePerformed",
          organizationId: actor.organizationId,
          aggregateType: "dental_procedure",
          aggregateId: procedure.id,
          facilityId: procedure.facilityId,
          patientId,
          payload: { encounterId: encounter.id, procedureCode: type.code, planItemId: procedure.planItemId },
        });
        return { ...strip(procedure), procedure: { code: type.code, name: type.name }, label: procedureLabel(type.name, procedure.tooth, surfaces) };
      });
    } catch (error) {
      if (asPgError(error)?.constraint === "dental_procedure_plan_item_uq") {
        throw new ConflictError("This plan item has already been carried out", undefined, "plan_item_completed");
      }
      throw error;
    }
  }

  /**
   * A procedure recorded in error: it leaves the chart, its plan item is open again, and billing cancels its charge
   * while it is not yet on an issued invoice. The record stays, with the reason.
   */
  async markEnteredInError(actor: Actor, procedureId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(dentalProcedure)
        .where(and(eq(dentalProcedure.organizationId, actor.organizationId), eq(dentalProcedure.id, procedureId)))
        .for("update");
      const procedure = found(current, "Procedure");
      if (procedure.status !== "recorded") throw new BusinessRuleError("The procedure is already marked entered in error", "already_entered_in_error");
      const [row] = (await tx
        .update(dentalProcedure)
        .set({ status: "entered_in_error", enteredInErrorReason: reason, enteredInErrorAt: new Date(), enteredInErrorBy: actor.userId })
        .where(eq(dentalProcedure.id, procedureId))
        .returning()) as [DentalProcedureRecord];
      if (procedure.planItemId) await this.plans.reopenItem(tx, actor.organizationId, procedure.planItemId);
      await this.audit.record(tx, actor, {
        action: "dental.procedure.entered-in-error",
        resourceType: "dental_procedure",
        resourceId: procedureId,
        patientId: procedure.patientId,
        reason,
      });
      await this.events.record(tx, {
        type: "DentalProcedureEnteredInError",
        organizationId: actor.organizationId,
        aggregateType: "dental_procedure",
        aggregateId: procedureId,
        facilityId: procedure.facilityId,
        patientId: procedure.patientId,
      });
      const states = await this.chart.procedureStates(tx, actor.organizationId, [procedureId]);
      if (states.length) {
        await this.chart.chartUpdated(
          tx,
          actor.organizationId,
          procedure.patientId,
          procedure.facilityId,
          "procedure",
          procedureId,
          states.map((s) => s.tooth),
        );
      }
      return strip(row);
    });
  }

  async forPatient(organizationId: string, patientId: string, limit = 200) {
    const rows = await this.db
      .select({ procedure: dentalProcedure, code: dentalProcedureType.code, name: dentalProcedureType.name })
      .from(dentalProcedure)
      .innerJoin(dentalProcedureType, eq(dentalProcedureType.id, dentalProcedure.procedureTypeId))
      .where(and(eq(dentalProcedure.organizationId, organizationId), eq(dentalProcedure.patientId, patientId)))
      .orderBy(desc(dentalProcedure.performedAt))
      .limit(limit);
    return rows.map((r) => ({
      ...strip(r.procedure),
      procedure: { code: r.code, name: r.name },
      label: procedureLabel(r.name, r.procedure.tooth, r.procedure.surfaces),
    }));
  }

  /** What billing charges for a procedure still on record (undefined once entered in error). */
  async billable(organizationId: string, procedureId: string): Promise<BillableDentalProcedure | undefined> {
    const [row] = await this.db
      .select({ procedure: dentalProcedure, code: dentalProcedureType.code, name: dentalProcedureType.name })
      .from(dentalProcedure)
      .innerJoin(dentalProcedureType, eq(dentalProcedureType.id, dentalProcedure.procedureTypeId))
      .where(and(eq(dentalProcedure.organizationId, organizationId), eq(dentalProcedure.id, procedureId)));
    if (!row || row.procedure.status !== "recorded") return undefined;
    const facility = await this.organizations.getFacility(organizationId, row.procedure.facilityId);
    return {
      id: row.procedure.id,
      patientId: row.procedure.patientId,
      facilityId: row.procedure.facilityId,
      procedureCode: row.code,
      description: procedureLabel(row.name, row.procedure.tooth, row.procedure.surfaces),
      serviceDate: localDate(row.procedure.performedAt, facility.timezone),
      surfaceCount: row.procedure.surfaces.length,
    };
  }
}
