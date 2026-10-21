import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, type DbExecutor } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { createRouteTemplateSchema, updateRouteTemplateSchema } from "../clinic.dto";
import { routeTemplate, routeTemplateDefault, type RouteTemplateRecord, routeTemplateStep, servicePoint, visitType } from "../clinic.schema";
import { assertVersion, found } from "../clinic-support";
import { routePlanProblem } from "../domain/queue-state";
import type { ServicePointBrief } from "./service-point.service";

export interface RouteTemplateView {
  id: string;
  facilityId: string;
  code: string;
  name: string;
  status: "active" | "inactive";
  version: number;
  createdAt: Date;
  updatedAt: Date;
  /** The stops in order, as the service points are named now. */
  steps: ServicePointBrief[];
  /** The template is active and every stop is still an active service point: it can be applied. */
  usable: boolean;
  /** Visit types this template is offered first for at the facility. */
  defaultForVisitTypeIds: string[];
}

/**
 * The routes a facility plans again and again (docs/domains/clinic.md, "Route templates"; migration 0116). A template is
 * a recipe of service points: applying it writes the ordinary visit route, so nothing about a route already planned
 * changes when the template does. Nothing here decides a route for a patient.
 */
@Injectable()
export class RouteTemplateService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  /** A facility's templates by name, with their stops. Inactive ones only on request. */
  async list(actor: Actor, facilityId: string, includeInactive = false): Promise<RouteTemplateView[]> {
    await this.organizations.getFacility(actor.organizationId, facilityId);
    const conditions = [eq(routeTemplate.organizationId, actor.organizationId), eq(routeTemplate.facilityId, facilityId)];
    if (!includeInactive) conditions.push(eq(routeTemplate.status, "active"));
    const rows = await this.db
      .select()
      .from(routeTemplate)
      .where(and(...conditions))
      .orderBy(asc(routeTemplate.name));
    return this.views(this.db, actor.organizationId, rows);
  }

  async create(actor: Actor, input: z.infer<typeof createRouteTemplateSchema>): Promise<RouteTemplateView> {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    this.assertRoute(input.servicePointIds);
    return this.db.transaction(async (tx) => {
      await this.assertActiveServicePoints(tx, actor.organizationId, input.facilityId, input.servicePointIds);
      const [created] = await tx
        .insert(routeTemplate)
        .values({ organizationId: actor.organizationId, facilityId: input.facilityId, code: input.code, name: input.name, createdBy: actor.userId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Route template code "${input.code}" is already in use at this facility`, undefined, "route_template_exists");
      await this.writeSteps(tx, created, input.servicePointIds);
      if (input.defaultForVisitTypeIds) await this.writeDefaults(tx, actor, created, input.defaultForVisitTypeIds);
      await this.audit.record(tx, actor, {
        action: "route-template.create",
        resourceType: "route_template",
        resourceId: created.id,
        metadata: { facilityId: created.facilityId, code: created.code, steps: input.servicePointIds.length },
      });
      return (await this.views(tx, actor.organizationId, [created]))[0]!;
    });
  }

  async update(actor: Actor, routeTemplateId: string, input: z.infer<typeof updateRouteTemplateSchema>): Promise<RouteTemplateView> {
    const { version, servicePointIds, defaultForVisitTypeIds, ...changes } = input;
    if (servicePointIds) this.assertRoute(servicePointIds);
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(routeTemplate)
        .where(and(eq(routeTemplate.organizationId, actor.organizationId), eq(routeTemplate.id, routeTemplateId)))
        .for("update");
      const current = found(before, "Route template");
      assertVersion(current.version, version, "Route template");
      if (servicePointIds) await this.assertActiveServicePoints(tx, actor.organizationId, current.facilityId, servicePointIds);
      const [updated] = await tx
        .update(routeTemplate)
        .set({ ...changes, updatedAt: new Date(), version: sql`${routeTemplate.version} + 1` })
        .where(eq(routeTemplate.id, routeTemplateId))
        .returning();
      const row = found(updated, "Route template");
      let stopsBefore: string[] | undefined;
      if (servicePointIds) {
        stopsBefore = await this.stopIds(tx, routeTemplateId);
        await tx.delete(routeTemplateStep).where(eq(routeTemplateStep.routeTemplateId, routeTemplateId));
        await this.writeSteps(tx, row, servicePointIds);
      }
      if (defaultForVisitTypeIds) await this.writeDefaults(tx, actor, row, defaultForVisitTypeIds);
      await this.audit.record(tx, actor, {
        action: "route-template.update",
        resourceType: "route_template",
        resourceId: routeTemplateId,
        changes: {
          ...(changes.name !== undefined && changes.name !== current.name ? { name: { from: current.name, to: changes.name } } : {}),
          ...(changes.status !== undefined && changes.status !== current.status ? { status: { from: current.status, to: changes.status } } : {}),
          ...(servicePointIds ? { stops: { from: stopsBefore, to: servicePointIds } } : {}),
        },
        metadata: { facilityId: current.facilityId, code: current.code, ...(defaultForVisitTypeIds ? { defaultFor: defaultForVisitTypeIds.length } : {}) },
      });
      return (await this.views(tx, actor.organizationId, [row]))[0]!;
    });
  }

  // ---- internals ----------------------------------------------------------------------------------------

  private assertRoute(servicePointIds: readonly string[]): void {
    // The first stop is where the patient is sent; none may repeat the one before it.
    const problem = routePlanProblem(servicePointIds, null);
    if (problem) throw new BusinessRuleError("A stop cannot follow itself", problem);
  }

  private async assertActiveServicePoints(executor: DbExecutor, organizationId: string, facilityId: string, ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const rows = await executor
      .select({ id: servicePoint.id, name: servicePoint.name, status: servicePoint.status })
      .from(servicePoint)
      .where(and(eq(servicePoint.organizationId, organizationId), eq(servicePoint.facilityId, facilityId), inArray(servicePoint.id, unique)));
    if (rows.length !== unique.length) throw new BusinessRuleError("A stop is not a service point of this facility", "service_point_unknown");
    const inactive = rows.find((r) => r.status !== "active");
    if (inactive) throw new BusinessRuleError(`${inactive.name} is no longer in use`, "service_point_inactive");
  }

  private async writeSteps(executor: DbExecutor, template: RouteTemplateRecord, ids: readonly string[]): Promise<void> {
    await executor.insert(routeTemplateStep).values(
      ids.map((servicePointId, index) => ({
        organizationId: template.organizationId,
        facilityId: template.facilityId,
        routeTemplateId: template.id,
        position: index + 1,
        servicePointId,
      })),
    );
  }

  /** Makes the template the offered one for exactly these visit types (a visit type has one default per facility). */
  private async writeDefaults(executor: DbExecutor, actor: Actor, template: RouteTemplateRecord, visitTypeIds: readonly string[]): Promise<void> {
    const unique = [...new Set(visitTypeIds)];
    if (unique.length > 0) {
      const known = await executor
        .select({ id: visitType.id })
        .from(visitType)
        .where(and(eq(visitType.organizationId, actor.organizationId), inArray(visitType.id, unique)));
      if (known.length !== unique.length) throw new BusinessRuleError("A visit type is not known", "visit_type_unknown");
    }
    await executor.delete(routeTemplateDefault).where(eq(routeTemplateDefault.routeTemplateId, template.id));
    if (unique.length === 0) return;
    await executor
      .insert(routeTemplateDefault)
      .values(
        unique.map((visitTypeId) => ({
          organizationId: template.organizationId,
          facilityId: template.facilityId,
          visitTypeId,
          routeTemplateId: template.id,
          updatedBy: actor.userId,
        })),
      )
      .onConflictDoUpdate({
        target: [routeTemplateDefault.facilityId, routeTemplateDefault.visitTypeId],
        set: { routeTemplateId: template.id, updatedBy: actor.userId, updatedAt: new Date() },
      });
  }

  private async stopIds(executor: DbExecutor, routeTemplateId: string): Promise<string[]> {
    const rows = await executor
      .select({ servicePointId: routeTemplateStep.servicePointId })
      .from(routeTemplateStep)
      .where(eq(routeTemplateStep.routeTemplateId, routeTemplateId))
      .orderBy(asc(routeTemplateStep.position));
    return rows.map((r) => r.servicePointId);
  }

  private async views(executor: DbExecutor, organizationId: string, templates: readonly RouteTemplateRecord[]): Promise<RouteTemplateView[]> {
    if (templates.length === 0) return [];
    const ids = templates.map((t) => t.id);
    const steps = await executor
      .select({
        routeTemplateId: routeTemplateStep.routeTemplateId,
        position: routeTemplateStep.position,
        id: servicePoint.id,
        code: servicePoint.code,
        name: servicePoint.name,
        kind: servicePoint.kind,
        location: servicePoint.location,
        status: servicePoint.status,
      })
      .from(routeTemplateStep)
      .innerJoin(servicePoint, and(eq(servicePoint.id, routeTemplateStep.servicePointId), eq(servicePoint.organizationId, organizationId)))
      .where(inArray(routeTemplateStep.routeTemplateId, ids))
      .orderBy(asc(routeTemplateStep.routeTemplateId), asc(routeTemplateStep.position));
    const defaults = await executor
      .select({ routeTemplateId: routeTemplateDefault.routeTemplateId, visitTypeId: routeTemplateDefault.visitTypeId })
      .from(routeTemplateDefault)
      .where(inArray(routeTemplateDefault.routeTemplateId, ids));
    return templates.map((t) => {
      const own = steps.filter((s) => s.routeTemplateId === t.id);
      return {
        id: t.id,
        facilityId: t.facilityId,
        code: t.code,
        name: t.name,
        status: t.status,
        version: t.version,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        steps: own.map(({ id, code, name, kind, location }) => ({ id, code, name, kind, location })),
        usable: t.status === "active" && own.length > 0 && own.every((s) => s.status === "active"),
        defaultForVisitTypeIds: defaults.filter((d) => d.routeTemplateId === t.id).map((d) => d.visitTypeId),
      };
    });
  }
}
