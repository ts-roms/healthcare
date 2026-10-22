import { type DbExecutor } from "@healthcare/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type RouteStepStatus, visitRouteStep, type VisitRouteStepRecord } from "../clinic.schema";
import type { ServicePointBrief } from "../config/service-point.service";
import { routeInPlan } from "../domain/queue-state";

/** One stop of a visit's route as queue rows and the route endpoints show it (removed steps are left out). */
export interface RouteStepView {
  id: string;
  position: number;
  status: Exclude<RouteStepStatus, "removed">;
  servicePointId: string;
  servicePoint: ServicePointBrief | null;
  startedAt: Date | null;
  completedAt: Date | null;
  note: string | null;
}

/** Every step ever planned for the visits, grouped by visit (one query; the queue board and the route commands). */
export async function loadRouteSteps(executor: DbExecutor, organizationId: string, visitIds: readonly string[]): Promise<Map<string, VisitRouteStepRecord[]>> {
  const result = new Map<string, VisitRouteStepRecord[]>();
  if (visitIds.length === 0) return result;
  const rows = await executor
    .select()
    .from(visitRouteStep)
    .where(and(eq(visitRouteStep.organizationId, organizationId), inArray(visitRouteStep.visitId, [...visitIds])))
    .orderBy(asc(visitRouteStep.position), asc(visitRouteStep.plannedAt));
  for (const row of rows) {
    const steps = result.get(row.visitId) ?? [];
    steps.push(row);
    result.set(row.visitId, steps);
  }
  return result;
}

/** The steps still in the plan, in order, with their service points' names. */
export function toRouteStepViews(rows: readonly VisitRouteStepRecord[], briefs: ReadonlyMap<string, ServicePointBrief>): RouteStepView[] {
  return routeInPlan(rows).map((r) => ({
    id: r.id,
    position: r.position,
    status: r.status as Exclude<RouteStepStatus, "removed">,
    servicePointId: r.servicePointId,
    servicePoint: briefs.get(r.servicePointId) ?? null,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    note: r.note,
  }));
}
