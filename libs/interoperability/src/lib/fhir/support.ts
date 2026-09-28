import type { Address, CodeableConcept, Coding, Identifier, Meta, Reference } from "fhir/r4";
import type { FhirContext } from "./sources";
import { SYSTEMS } from "./terminology";

/** A local reference ("Patient/123"). */
export function ref(type: string, id: string, display?: string | null): Reference {
  return display ? { reference: `${type}/${id}`, display } : { reference: `${type}/${id}` };
}

export function text(value: string): CodeableConcept {
  return { text: value };
}

export function concept(coding: Coding, textValue?: string): CodeableConcept {
  return textValue ? { coding: [coding], text: textValue } : { coding: [coding] };
}

/** A namespace for the platform's own identifiers or code systems under the configured base. */
export function localSystem(ctx: FhirContext, path: string): string {
  return `${ctx.identifierBase}/${path}`;
}

/** The system URI for an identifier type (configured, else a local namespace — never an invented official URI). */
export function identifierSystem(ctx: FhirContext, type: string): string {
  return ctx.identifierSystems?.[type] ?? localSystem(ctx, `identifier/${type.replace(/_/g, "-")}`);
}

const KNOWN_CODE_SYSTEMS: Record<string, string> = { "icd-10": SYSTEMS.icd10, icd10: SYSTEMS.icd10 };

/** The system URI for an internal coding-system key (configured, ICD-10 known, else a local namespace). */
export function codeSystem(ctx: FhirContext, key: string): string {
  return ctx.codeSystems?.[key] ?? KNOWN_CODE_SYSTEMS[key.toLowerCase()] ?? localSystem(ctx, `codesystem/${key}`);
}

/**
 * The `meta.tag` that marks a resource as received from another system (an accepted FHIR import), not recorded by
 * this organization: a platform-defined code in the local namespace (`{identifierBase}/codesystem/record-source`).
 */
export function externalSourceTag(ctx: FhirContext): Coding {
  return { system: localSystem(ctx, "codesystem/record-source"), code: "external-import", display: "Imported from another system" };
}

const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;

/**
 * `meta` of an externally sourced resource: the tag and, when the sender declared its system as an absolute URI, that
 * URI as `meta.source` (as declared, not verified).
 */
export function externalMeta(ctx: FhirContext, extra: { lastUpdated?: string; declaredSource?: string | null } = {}): Meta {
  return compact<Meta>({
    lastUpdated: extra.lastUpdated,
    source: extra.declaredSource && extra.declaredSource.length <= 200 && ABSOLUTE_URI.test(extra.declaredSource) ? extra.declaredSource : undefined,
    tag: [externalSourceTag(ctx)],
  });
}

export function identifier(system: string, value: string, extra: Partial<Identifier> = {}): Identifier {
  return { system, value, ...extra };
}

/** A Philippine address: street and barangay as lines, city/municipality, province as district, region as state. */
export function address(a: {
  use?: string;
  line1: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
  region: string | null;
  postalCode: string | null;
  country?: string | null;
}): Address {
  const use = a.use === "temporary" ? "temp" : a.use === "home" || a.use === "work" || a.use === "billing" ? a.use : undefined;
  return compact({
    use,
    type: "physical" as const,
    line: [a.line1, a.barangay ? `Brgy. ${a.barangay.replace(/^(brgy\.?|barangay)\s+/i, "")}` : null].filter((l): l is string => Boolean(l)),
    city: a.cityMunicipality ?? undefined,
    district: a.province ?? undefined,
    state: a.region ?? undefined,
    postalCode: a.postalCode ?? undefined,
    country: a.country ?? "PH",
  });
}

/** Drops undefined, null, empty strings and empty arrays (FHIR forbids empty elements). */
export function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}
