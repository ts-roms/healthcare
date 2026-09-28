import { type Actor, BusinessRuleError, ForbiddenError, NotFoundError, requireFacilityId, VersionConflictError } from "@healthcare/core";
import type { DentalContext, DentalEncounter, DentalPractitioner } from "./ports";

export function strip<T extends { organizationId: string }>(row: T): Omit<T, "organizationId"> {
  const { organizationId: _o, ...rest } = row;
  return rest;
}

export function found<T>(row: T | undefined, resource: string): T {
  if (!row) throw new NotFoundError(resource);
  return row;
}

export function assertVersion(current: number, expected: number, resource: string): void {
  if (current !== expected) throw new VersionConflictError(resource, expected);
}

/** Examinations, charting, treatment plans and procedures are recorded by a dentist (the actor's practitioner record). */
export async function requireDentist(context: DentalContext, actor: Actor): Promise<DentalPractitioner> {
  const practitioner = await context.practitionerForUser(actor.organizationId, actor.userId);
  if (practitioner?.profession !== "dentist") throw new ForbiddenError("Only a dentist can record this");
  return practitioner;
}

/** The patient's encounter in progress at the selected facility: dental work is recorded during a visit. */
export async function requireOpenEncounter(context: DentalContext, actor: Actor, encounterId: string, patientId?: string): Promise<DentalEncounter> {
  const facilityId = requireFacilityId(actor);
  const encounter = await context.encounter(actor.organizationId, encounterId);
  if (!encounter || encounter.facilityId !== facilityId || (patientId && encounter.patientId !== patientId)) throw new NotFoundError("Encounter");
  if (encounter.status !== "in_progress") throw new BusinessRuleError("The encounter is not in progress", "encounter_not_in_progress");
  return encounter;
}

/** Validation problems keyed for the client (e.g. { "16": ["caries needs the affected surfaces"] }). */
export function rejectIssues(issues: Record<string, string[]>, message: string, code: string): void {
  const entries = Object.entries(issues).filter(([, list]) => list.length);
  if (entries.length) throw new BusinessRuleError(message, code, Object.fromEntries(entries));
}
