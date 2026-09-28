import type { Bundle, BundleEntry, BundleLink, CapabilityStatement, FhirResource, OperationOutcome } from "fhir/r4";
import { toLocation, toOrganization, toPatient, toPractitioner } from "./administrative";
import { toAllergyIntolerance, toAppointment, toCondition, toEncounter, toNoKnownAllergies, toVitalSignObservations } from "./clinical";
import { toDocumentReference } from "./documents";
import { toExternalHistoryResource } from "./external";
import { toCarePlan, toDiagnosticReport, toLabObservation, toMedicationRequests, toServiceRequests } from "./orders";
import { compact } from "./support";
import { DEFAULT_PAGING, matchesLastUpdated, PAGE_SIZE, type Paging, type SearchParameters } from "./search";
import type { FhirContext, PatientRecordSource } from "./sources";
import { FHIR_VERSION } from "./terminology";

/** Resource types the endpoint serves for a patient (search by `patient`). */
export const PATIENT_COMPARTMENT_TYPES = [
  "Encounter",
  "Condition",
  "AllergyIntolerance",
  "Observation",
  "Appointment",
  "ServiceRequest",
  "DiagnosticReport",
  "MedicationRequest",
  "MedicationStatement",
  "CarePlan",
  "DocumentReference",
] as const;
export type CompartmentType = (typeof PATIENT_COMPARTMENT_TYPES)[number];

/**
 * Types whose resources carry a reliable `meta.lastUpdated`, so `_lastUpdated` can filter them: prescriptions are
 * immutable once issued (cancel/replace records its time), exported documents never change after upload, and external
 * history entries (the only MedicationStatements, and imported document descriptions) change only when marked entered
 * in error (database triggers). The other records are updated in place without a trustworthy change time for
 * everything their resource shows (see docs/interoperability/fhir.md), so `_lastUpdated` is refused for them rather
 * than answered approximately.
 */
export const LAST_UPDATED_TYPES: readonly CompartmentType[] = ["MedicationRequest", "MedicationStatement", "DocumentReference"];

/** Every resource of one patient's record, the patient first; shared resources (organization, facilities, practitioners) after. */
export function patientResources(ctx: FhirContext, src: PatientRecordSource): { patient: FhirResource; clinical: FhirResource[]; supporting: FhirResource[] } {
  const patientId = src.patient.id;
  const clinical: FhirResource[] = [];
  for (const e of src.encounters) clinical.push(toEncounter(ctx, patientId, e, src.diagnoses));
  for (const d of src.diagnoses) clinical.push(toCondition(ctx, patientId, d));
  for (const a of src.allergies) clinical.push(toAllergyIntolerance(ctx, patientId, a));
  if (src.allergyReview?.noKnownAllergies && !src.allergies.some((a) => a.status === "active")) {
    clinical.push(toNoKnownAllergies(patientId, src.allergyReview));
  }
  for (const v of src.vitals) clinical.push(...toVitalSignObservations(patientId, v));
  for (const a of src.appointments) clinical.push(toAppointment(patientId, a));
  for (const order of src.labOrders) {
    clinical.push(...toServiceRequests(ctx, patientId, order));
    for (const item of order.items) if (item.result) clinical.push(toLabObservation(ctx, patientId, order, item, item.result));
    const report = toDiagnosticReport(ctx, patientId, order);
    if (report) clinical.push(report);
  }
  for (const p of src.prescriptions) clinical.push(...toMedicationRequests(ctx, patientId, p));
  for (const c of src.carePlans) clinical.push(toCarePlan(patientId, c));
  for (const d of src.documents ?? []) clinical.push(toDocumentReference(ctx, patientId, d));
  // External history (tagged as imported); document descriptions are withheld with the documents.
  for (const e of src.externalHistory) if (e.kind !== "document" || src.documents !== null) clinical.push(toExternalHistoryResource(ctx, patientId, e));

  const supporting: FhirResource[] = [
    toOrganization(ctx),
    ...src.facilities.map((f) => toLocation(ctx, f)),
    ...src.practitioners.map((p) => toPractitioner(ctx, p)),
  ];
  return { patient: toPatient(ctx, src.patient), clinical: stableOrder(clinical), supporting };
}

const TYPE_RANK = new Map<string, number>(PATIENT_COMPARTMENT_TYPES.map((type, i) => [type, i]));

/** A deterministic order (type, then id) so that pages do not overlap or skip while the record is unchanged. */
function stableOrder(resources: FhirResource[]): FhirResource[] {
  const key = (r: FhirResource) => TYPE_RANK.get(r.resourceType) ?? TYPE_RANK.size;
  return [...resources].sort((a, b) => key(a) - key(b) || ((a.id ?? "") < (b.id ?? "") ? -1 : (a.id ?? "") > (b.id ?? "") ? 1 : 0));
}

/** Every local reference ("Type/id") made anywhere inside the resources. */
function referencesIn(resources: FhirResource[]): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "reference" && typeof v === "string") found.add(v);
        else walk(v);
      }
    }
  };
  walk(resources);
  return found;
}

function entry(ctx: FhirContext, resource: FhirResource, mode: "match" | "include"): BundleEntry {
  return { fullUrl: `${ctx.baseUrl}/${resource.resourceType}/${resource.id}`, resource, search: { mode } };
}

/** An informational notice inside a searchset (e.g. that documents were withheld). */
function notice(diagnostics: string): BundleEntry {
  const outcome: OperationOutcome = { resourceType: "OperationOutcome", issue: [{ severity: "information", code: "suppressed", diagnostics }] };
  return { resource: outcome, search: { mode: "outcome" } };
}

/** The page's link URL: the request's own parameters plus `_count` and `_offset`. */
function pageUrl(path: string, params: Array<[string, string]>, paging: Paging): string {
  const query = new URLSearchParams([...params, ["_count", String(paging.count)], ["_offset", String(paging.offset)]]);
  return `${path}?${query.toString()}`;
}

function links(path: string, params: Array<[string, string]>, paging: Paging, total: number): BundleLink[] {
  const out: BundleLink[] = [{ relation: "self", url: pageUrl(path, params, paging) }];
  if (paging.count > 0 && paging.offset + paging.count < total) {
    out.push({ relation: "next", url: pageUrl(path, params, { count: paging.count, offset: paging.offset + paging.count }) });
  }
  if (paging.count > 0 && paging.offset > 0) {
    out.push({ relation: "previous", url: pageUrl(path, params, { count: paging.count, offset: Math.max(0, Math.min(paging.offset, total) - paging.count) }) });
  }
  return out;
}

/**
 * One page of matches, with the shared resources (organization, facilities, practitioners) that the page references
 * as includes. `total` is always the number of matches in the whole result, not in the page.
 */
function searchset(
  ctx: FhirContext,
  matches: FhirResource[],
  supporting: FhirResource[],
  paging: Paging,
  link: BundleLink[],
  now: Date,
  notices: BundleEntry[],
): Bundle {
  const page = matches.slice(paging.offset, paging.offset + paging.count);
  const referenced = referencesIn(page);
  const includes = supporting.filter((r) => referenced.has(`${r.resourceType}/${r.id}`));
  const entries = [...page.map((r) => entry(ctx, r, "match")), ...includes.map((r) => entry(ctx, r, "include")), ...notices];
  // FHIR JSON has no empty arrays: an empty page has no entry element.
  return compact<Bundle>({ resourceType: "Bundle", type: "searchset", timestamp: now.toISOString(), total: matches.length, link, entry: entries });
}

const DOCUMENTS_WITHHELD = "DocumentReference resources are not included: this account may not read documents (document.read).";

/** Patient/$everything: the patient's whole record as a searchset Bundle, paged (the Patient comes first). */
export function patientEverything(ctx: FhirContext, src: PatientRecordSource, paging: Paging = DEFAULT_PAGING, now = new Date()): Bundle {
  const { patient, clinical, supporting } = patientResources(ctx, src);
  const matches = [patient, ...clinical];
  const path = `${ctx.baseUrl}/Patient/${src.patient.id}/$everything`;
  return searchset(ctx, matches, supporting, paging, links(path, [], paging, matches.length), now, src.documents === null ? [notice(DOCUMENTS_WITHHELD)] : []);
}

/** A search by patient for one resource type (e.g. Observation?patient=…), paged and optionally filtered by `_lastUpdated`. */
export function searchByPatient(
  ctx: FhirContext,
  src: PatientRecordSource,
  type: CompartmentType,
  params: SearchParameters = { paging: DEFAULT_PAGING, lastUpdated: {} },
  now = new Date(),
): Bundle {
  const { clinical } = patientResources(ctx, src);
  const matches = clinical.filter((r) => r.resourceType === type && matchesLastUpdated(params.lastUpdated, r.meta?.lastUpdated));
  const query: Array<[string, string]> = [["patient", src.patient.id]];
  if (params.lastUpdated.ge !== undefined) query.push(["_lastUpdated", `ge${params.lastUpdated.ge}`]);
  if (params.lastUpdated.le !== undefined) query.push(["_lastUpdated", `le${params.lastUpdated.le}`]);
  return searchset(ctx, matches, [], params.paging, links(`${ctx.baseUrl}/${type}`, query, params.paging, matches.length), now, []);
}

const IMPORTED = "Resources received from other systems (accepted FHIR imports) carry meta.tag record-source#external-import.";
const TYPE_DOCUMENTATION: Partial<Record<CompartmentType, string>> = {
  Condition: `Diagnoses recorded in encounters, and conditions from other systems (always unconfirmed). ${IMPORTED}`,
  AllergyIntolerance: `${IMPORTED} Imported allergies are always unconfirmed.`,
  Observation: `Vital signs, released laboratory results (performer: the organization, or a contained reference laboratory for a send-out), and observations from other systems. ${IMPORTED}`,
  MedicationStatement: `Medication history from other systems only (never a prescription of this organization). ${IMPORTED}`,
  DocumentReference: `Available documents only (not archived ones), and document descriptions from other systems (no content); requires document.read. ${IMPORTED}`,
};

/** What this read-only endpoint supports (GET /metadata). */
export function capabilityStatement(ctx: FhirContext, now = new Date()): CapabilityStatement {
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    date: now.toISOString(),
    publisher: ctx.organization.name,
    kind: "instance",
    software: { name: "Healthcare Platform FHIR facade" },
    implementation: { description: "Read-only FHIR R4 view of the platform's records (mapped from the internal model).", url: ctx.baseUrl },
    fhirVersion: FHIR_VERSION,
    format: ["json"],
    rest: [
      {
        mode: "server",
        security: {
          cors: false,
          description: "Bearer token of a staff account holding interop.fhir.read, with the organization selected. Every access is audited.",
        },
        documentation:
          `Searches and Patient/$everything are paged: _count (default ${PAGE_SIZE.default}, at most ${PAGE_SIZE.max}; 0 returns only the total) ` +
          "and _offset, with self/next/previous links; total is the number of matches in the whole result. Matches are ordered by type, then id.",
        resource: [
          {
            type: "Patient",
            interaction: [{ code: "read" }],
            operation: [{ name: "everything", definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything" }],
          },
          ...PATIENT_COMPARTMENT_TYPES.map((type) => ({
            type,
            interaction: [{ code: "search-type" as const }],
            ...(TYPE_DOCUMENTATION[type] ? { documentation: TYPE_DOCUMENTATION[type] } : {}),
            searchParam: [
              { name: "patient", type: "reference" as const, documentation: "Required: the patient's id" },
              ...(LAST_UPDATED_TYPES.includes(type)
                ? [
                    {
                      name: "_lastUpdated",
                      definition: "http://hl7.org/fhir/SearchParameter/Resource-lastUpdated",
                      type: "date" as const,
                      documentation: "ge and/or le only; a date is a whole day in Asia/Manila time",
                    },
                  ]
                : []),
            ],
          })),
          {
            type: "Binary",
            interaction: [{ code: "read" }],
            documentation:
              "The content of a DocumentReference: answers with a redirect to a short-lived signed download of the file (native content only). Requires document.read; audited.",
          },
        ],
      },
    ],
  };
}

/** A FHIR error body. */
export function operationOutcome(
  code: "not-found" | "forbidden" | "invalid" | "login" | "exception" | "not-supported" | "throttled" | "conflict" | "too-costly",
  diagnostics: string,
): OperationOutcome {
  return { resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics }] };
}
