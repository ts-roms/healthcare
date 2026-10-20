import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, DomainEventPublisher, NotFoundError } from "@healthcare/core";
import { eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { advanceRouteSchema, planRouteSchema, skipRouteStepSchema } from "../clinic.dto";
import { type VisitRecord, visitRouteStep, type VisitRouteStepRecord } from "../clinic.schema";
import { assertVersion, found } from "../clinic-support";
import { ServicePointService } from "../config/service-point.service";
import { canAdvanceRoute, canRouteVisit, currentRouteStep, nextRouteStep, routeInPlan, routePlanProblem } from "../domain/queue-state";
import { loadRouteSteps, type RouteStepView, toRouteStepViews } from "./visit-route.queries";
import { toVisitView, VisitService, type VisitView } from "./visit.service";

/** What the route commands answer: the visit as it now is, its route, and whether the patient was called. */
export interface VisitRouteResult {
  visit: VisitView;
  route: RouteStepView[];
  /** The facility calls automatically and the visit was sent on: `called_to` now names the next service point's location. */
  called: boolean;
}

const REFUSAL: Record<"visit_not_routable" | "no_route" | "route_complete", string> = {
  visit_not_routable: "The visit cannot be sent on from its current state",
  no_route: "The visit has no route",
  route_complete: "The route is complete; the patient is at the last stop",
};

/**
 * A visit's route (migration 0115): the planned sequence of service points. Planning appends steps; "done here, send
 * on" finishes the current step and moves the visit to the next one through the ordinary routing history
 * (`VisitService.routeIn`, so `visit_routing`, `VisitRouted` and the audit stay the single record of where a visit
 * went), calling the patient there when the facility asks for it. Nothing clinical completes a step: every move is
 * a person's click (docs/domains/clinic.md, "Visit routes").
 */
@Injectable()
export class VisitRouteService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly visits: VisitService,
    private readonly servicePoints: ServicePointService,
  ) {}

  /** The visit's route as planned, in order (removed steps left out). */
  async route(actor: Actor, visitId: string): Promise<RouteStepView[]> {
    const current = await this.visits.get(actor, visitId);
    if (actor.facilityId && current.facilityId !== actor.facilityId) throw new NotFoundError("Visit");
    return this.views(this.db, actor.organizationId, visitId);
  }

  /** Sets the stops ahead of the visit from the queue board (replacing the planned ones; the current step stays). */
  async plan(actor: Actor, visitId: string, input: z.infer<typeof planRouteSchema>): Promise<VisitRouteResult> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockVisit(tx, actor, visitId, input.version);
      if (!canRouteVisit(current.status)) throw notRoutable(current);
      await this.planIn(tx, actor, current, input.servicePointIds);
      return { visit: toVisitView(current), route: await this.views(tx, actor.organizationId, visitId), called: false };
    });
  }

  /** "Done here, send on": the current step is done; the visit goes to the next planned service point. */
  async advance(actor: Actor, visitId: string, input: z.infer<typeof advanceRouteSchema>): Promise<VisitRouteResult> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockVisit(tx, actor, visitId, input.version);
      const steps = (await loadRouteSteps(tx, actor.organizationId, [visitId])).get(visitId) ?? [];
      const decision = canAdvanceRoute(current.status, steps);
      if (!decision.ok) throw new BusinessRuleError(REFUSAL[decision.code], decision.code);
      if (decision.current) await this.finishStep(tx, actor, decision.current, "done", input.note ?? null);
      const { visit, called } = await this.moveOn(tx, actor, current, decision.next);
      await this.audit.record(tx, actor, {
        action: "visit.route-advance",
        resourceType: "visit",
        resourceId: visitId,
        patientId: current.patientId,
        metadata: { doneStepId: decision.current?.id ?? null, nextStepId: decision.next?.id ?? null, called },
      });
      await this.events.record(tx, {
        type: "VisitRouteAdvanced",
        organizationId: current.organizationId,
        aggregateType: "visit",
        aggregateId: visitId,
        facilityId: current.facilityId,
        patientId: current.patientId,
        payload: { doneStepId: decision.current?.id ?? null, nextStepId: decision.next?.id ?? null, called },
      });
      return { visit: toVisitView(visit), route: await this.views(tx, actor.organizationId, visitId), called };
    });
  }

  /** Skips a planned step (nothing moves) or the current one (the visit then moves on); the reason is kept on the step. */
  async skip(actor: Actor, visitId: string, input: z.infer<typeof skipRouteStepSchema>): Promise<VisitRouteResult> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockVisit(tx, actor, visitId, input.version);
      const steps = (await loadRouteSteps(tx, actor.organizationId, [visitId])).get(visitId) ?? [];
      const step = steps.find((s) => s.id === input.stepId);
      if (!step || step.status === "removed") throw new NotFoundError("Route step");
      if (step.status !== "planned" && step.status !== "current") {
        throw new BusinessRuleError(`A step that is ${step.status} cannot be skipped`, "route_step_final");
      }
      if (step.status === "current" && !canRouteVisit(current.status)) throw notRoutable(current);
      await this.finishStep(tx, actor, step, "skipped", input.reason);
      let visit = current;
      let called = false;
      if (step.status === "current") {
        const next = nextRouteStep(steps.filter((s) => s.id !== step.id));
        ({ visit, called } = await this.moveOn(tx, actor, current, next));
      }
      await this.audit.record(tx, actor, {
        action: "visit.route-skip",
        resourceType: "visit",
        resourceId: visitId,
        patientId: current.patientId,
        reason: input.reason,
        metadata: { stepId: step.id, servicePointId: step.servicePointId, wasCurrent: step.status === "current", called },
      });
      return { visit: toVisitView(visit), route: await this.views(tx, actor.organizationId, visitId), called };
    });
  }

  // ---- used by triage (same library) ----------------------------------------------------------------------

  /**
   * Makes the service point the visit is at its current step (triage sends the patient to the first stop): nothing
   * when a current step already names it; a step finishing the previous current one otherwise.
   */
  async arriveIn(tx: DbExecutor, actor: Actor, row: VisitRecord): Promise<void> {
    if (!row.servicePointId) return;
    const steps = (await loadRouteSteps(tx, actor.organizationId, [row.id])).get(row.id) ?? [];
    const current = currentRouteStep(steps);
    if (current?.servicePointId === row.servicePointId) return;
    if (current) await this.finishStep(tx, actor, current, "done", null);
    const next = nextRouteStep(steps);
    if (next?.servicePointId === row.servicePointId) {
      await this.startStep(tx, next);
      return;
    }
    const [created] = await tx
      .insert(visitRouteStep)
      .values({
        organizationId: actor.organizationId,
        facilityId: row.facilityId,
        visitId: row.id,
        patientId: row.patientId,
        position: nextPosition(steps),
        servicePointId: row.servicePointId,
        status: "current",
        plannedBy: actor.userId,
        startedAt: new Date(),
      })
      .returning();
    found(created, "Route step");
  }

  /**
   * Replaces the stops still ahead of the visit (planned steps become `removed`; done, skipped and the current step
   * stay) with the given service points, in the caller's transaction. Each must be an active service point of the
   * facility; a stop may not repeat the one before it, nor the one the visit is at.
   */
  async planIn(tx: DbExecutor, actor: Actor, row: VisitRecord, servicePointIds: readonly string[]): Promise<void> {
    const steps = (await loadRouteSteps(tx, actor.organizationId, [row.id])).get(row.id) ?? [];
    const current = currentRouteStep(steps);
    const problem = routePlanProblem(servicePointIds, current?.servicePointId ?? row.servicePointId);
    if (problem === "route_empty") throw new BusinessRuleError("Choose at least one stop", problem);
    if (problem === "route_step_repeated") throw new BusinessRuleError("A stop cannot repeat the one before it", problem);
    const codes: string[] = [];
    for (const id of servicePointIds) codes.push((await this.servicePoints.requireActive(tx, actor.organizationId, row.facilityId, id)).code);
    const planned = steps.filter((s) => s.status === "planned").map((s) => s.id);
    if (planned.length > 0) {
      await tx.update(visitRouteStep).set({ status: "removed", completedAt: new Date(), completedBy: actor.userId }).where(inArray(visitRouteStep.id, planned));
    }
    let position = nextPosition(steps.filter((s) => !planned.includes(s.id)));
    const ids: string[] = [];
    for (const servicePointId of servicePointIds) {
      const [created] = await tx
        .insert(visitRouteStep)
        .values({
          organizationId: actor.organizationId,
          facilityId: row.facilityId,
          visitId: row.id,
          patientId: row.patientId,
          position: position++,
          servicePointId,
          status: "planned",
          plannedBy: actor.userId,
        })
        .returning();
      ids.push(found(created, "Route step").id);
    }
    await this.audit.record(tx, actor, {
      action: "visit.route-plan",
      resourceType: "visit",
      resourceId: row.id,
      patientId: row.patientId,
      metadata: { stepIds: ids, codes, removedStepIds: planned },
    });
    await this.events.record(tx, {
      type: "VisitRoutePlanned",
      organizationId: row.organizationId,
      aggregateType: "visit",
      aggregateId: row.id,
      facilityId: row.facilityId,
      patientId: row.patientId,
      payload: { stepIds: ids, removedStepIds: planned },
    });
  }

  // ---- internals ------------------------------------------------------------------------------------------

  /**
   * Sends the visit to the next step's service point (through the routing history, unless it is already there),
   * makes that step current and, when the facility calls automatically, calls the patient to the service point's
   * location — the same `called_at` / `called_to` the board sets, so the waiting-room display announces it.
   */
  private async moveOn(tx: DbExecutor, actor: Actor, row: VisitRecord, next: VisitRouteStepRecord | null): Promise<{ visit: VisitRecord; called: boolean }> {
    if (!next) return { visit: row, called: false };
    let visit = row;
    if (row.servicePointId !== next.servicePointId) visit = await this.visits.routeIn(tx, actor, row, next.servicePointId);
    await this.startStep(tx, next);
    const settings = await this.servicePoints.settings(actor.organizationId, row.facilityId, tx);
    if (!settings.autoCallOnRoute) return { visit, called: false };
    const target = found((await this.servicePoints.briefs(actor.organizationId, [next.servicePointId], tx)).get(next.servicePointId), "Service point");
    visit = await this.visits.callIn(tx, actor, visit, target.location ?? target.name, { automatic: true, routeStepId: next.id });
    return { visit, called: true };
  }

  private async startStep(tx: DbExecutor, step: VisitRouteStepRecord): Promise<void> {
    await tx.update(visitRouteStep).set({ status: "current", startedAt: new Date() }).where(eq(visitRouteStep.id, step.id));
  }

  private async finishStep(tx: DbExecutor, actor: Actor, step: VisitRouteStepRecord, status: "done" | "skipped", note: string | null): Promise<void> {
    await tx
      .update(visitRouteStep)
      .set({ status, completedAt: new Date(), completedBy: actor.userId, ...(note ? { note } : {}) })
      .where(eq(visitRouteStep.id, step.id));
  }

  private async lockVisit(tx: DbExecutor, actor: Actor, visitId: string, version: number): Promise<VisitRecord> {
    const current = await this.visits.lock(tx, actor.organizationId, visitId);
    if (actor.facilityId && current.facilityId !== actor.facilityId) throw new NotFoundError("Visit");
    assertVersion(current.version, version, "Visit");
    return current;
  }

  private async views(executor: DbExecutor, organizationId: string, visitId: string): Promise<RouteStepView[]> {
    const steps = (await loadRouteSteps(executor, organizationId, [visitId])).get(visitId) ?? [];
    const briefs = await this.servicePoints.briefs(
      organizationId,
      steps.map((s) => s.servicePointId),
      executor,
    );
    return toRouteStepViews(steps, briefs);
  }
}

/** The position after the last step still in the plan (a removed step frees its position). */
function nextPosition(steps: readonly VisitRouteStepRecord[]): number {
  return (routeInPlan(steps).at(-1)?.position ?? 0) + 1;
}

function notRoutable(row: VisitRecord): BusinessRuleError {
  return new BusinessRuleError(`A visit that is ${row.status.replace(/_/g, " ")} cannot be sent to a service point`, "visit_not_routable");
}
