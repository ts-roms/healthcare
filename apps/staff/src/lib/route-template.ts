import type { RouteTemplate } from "./api/types";

/**
 * Route templates (migration 0116) only fill in a route a person then confirms: they pick the stops, never decide
 * them. These helpers turn a template into what the triage form and the ticket panel already take.
 */

/** The first stop is where the patient is sent; the rest follow it (the triage form's "Send to" and "Then"). */
export function triageStopsFromTemplate(template: Pick<RouteTemplate, "steps">): { servicePointId: string; stops: string[] } | null {
  const [first, ...rest] = template.steps;
  return first ? { servicePointId: first.id, stops: rest.map((s) => s.id) } : null;
}

/**
 * The stops to plan after the service point a visit is at now: a template's own first stop is dropped when the patient
 * is already there (a stop cannot follow itself), so applying "Triage Room → X-ray" at the Triage Room plans only X-ray.
 */
export function stopsAfter(template: Pick<RouteTemplate, "steps">, atServicePointId: string | null): string[] {
  const ids = template.steps.map((s) => s.id);
  return ids[0] !== undefined && ids[0] === atServicePointId ? ids.slice(1) : ids;
}

/** The template offered first for a visit type, if the facility set one and it can still be used. */
export function defaultTemplateFor(templates: readonly RouteTemplate[], visitTypeId: string): RouteTemplate | null {
  return templates.find((t) => t.usable && t.defaultForVisitTypeIds.includes(visitTypeId)) ?? null;
}

/** Templates a nurse may apply now (inactive ones and ones with a stop no longer in use are not offered). */
export function usableTemplates(templates: readonly RouteTemplate[]): RouteTemplate[] {
  return templates.filter((t) => t.usable);
}

/** "Triage Room → Laboratory → X-ray" for a list or an option. */
export function routeSummary(template: Pick<RouteTemplate, "steps">): string {
  return template.steps.map((s) => s.name).join(" → ");
}
