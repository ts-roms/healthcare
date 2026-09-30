import type { Bundle, BundleEntry, BundleLink, CapabilityStatement, FhirResource, OperationOutcome } from "fhir/r4";
import { toLocation, toOrganization, toPatient, toPractitioner } from "./administrative";
import { toAllergyIntolerance, toAppointment, toCondition, toEncounter, toNoKnownAllergies, toVitalSignObservations } from "./clinical";
import { dentalResources } from "./dental";
import { toDocumentReference } from "./documents";
import { toExternalHistoryResource } from "./external";
import { historyResources } from "./history";
import { toImmunization } from "./immunization";
import { toCarePlan, toDiagnosticReport, toLabObservation, toMedicationRequests, toServiceRequests } from "./orders";
import { toReferralServiceRequest } from "./referrals";
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
  "Procedure",
  "Immunization",
  "FamilyMemberHistory",
] as const;
export type CompartmentType = (typeof PATIENT_COMPARTMENT_TYPES)[number];

/**
 * Types whose resources carry a reliable `meta.lastUpdated`, so `_lastUpdated` can filter them: prescriptions are
 * immutable once issued (cancel/replace records its time), exported documents never change after upload (a dental
 * image's description only when added or marked entered in error), external history entries (the only
 * MedicationStatements, and imported document descriptions), dental procedures and past procedures (the Procedures)
 * and family history entries change only when marked entered in error (database triggers), and immunizations only
 * when marked entered in error or when a reaction is added (database trigger). The other records are updated in place without a trustworthy
 * change time for everything their resource shows (see docs/interoperability/fhir.md), so `_lastUpdated` is refused for
 * them rather than answered approximately.
 */
export const LAST_UPDATED_TYPES: readonly CompartmentType[] = [
  "MedicationRequest",
  "MedicationStatement",
  "DocumentReference",
  "Procedure",
  "Immunization",
  "FamilyMemberHistory",
];

/** Types that include dental records (withheld from callers who may not read the dental record). */
export const DENTAL_TYPES: readonly CompartmentType[] = ["Observation", "CarePlan", "Procedure"];

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
  // Referrals point at their letter and reply only when those documents are exported too.
  const documentIds = src.documents ? new Set(src.documents.map((d) => d.id)) : null;
  for (const r of src.referrals) clinical.push(toReferralServiceRequest(ctx, patientId, r, documentIds));
  for (const d of src.documents ?? []) clinical.push(toDocumentReference(ctx, patientId, d));
  // External history (tagged as imported); document descriptions are withheld with the documents.
  for (const e of src.externalHistory) if (e.kind !== "document" || src.documents !== null) clinical.push(toExternalHistoryResource(ctx, patientId, e));
  // Dental record (withheld, with a notice, from callers who may not read it); dental images are documents, above.
  if (src.dental) clinical.push(...dentalResources(ctx, patientId, src.dental));
  for (const i of src.immunizations) clinical.push(toImmunization(ctx, patientId, i));
  // Past procedures and conditions, family and social history (substance use and sexual history only when included).
  clinical.push(...historyResources(ctx, patientId, src.history));

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
const SENSITIVE_WITHHELD =
  "Substance use and sexual history (social-history Observations) are not included: this account may not see them (history.read and encounter.write).";
const DENTAL_WITHHELD =
  "Dental records (Procedure resources, and dental CarePlan and Observation resources) are not included: this account may not read the dental record (dental.record.read).";

/**
 * Sensitive social history was left out for this caller. Said only when the patient has a social history at all, so
 * the notice never tells whether anything sensitive is recorded.
 */
function sensitiveWithheld(src: PatientRecordSource): boolean {
  return !src.history.sensitiveIncluded && src.history.social.length > 0;
}

/** Patient/$everything: the patient's whole record as a searchset Bundle, paged (the Patient comes first). */
export function patientEverything(ctx: FhirContext, src: PatientRecordSource, paging: Paging = DEFAULT_PAGING, now = new Date()): Bundle {
  const { patient, clinical, supporting } = patientResources(ctx, src);
  const matches = [patient, ...clinical];
  const path = `${ctx.baseUrl}/Patient/${src.patient.id}/$everything`;
  const notices = [
    ...(src.documents === null ? [notice(DOCUMENTS_WITHHELD)] : []),
    ...(src.dental === null ? [notice(DENTAL_WITHHELD)] : []),
    ...(sensitiveWithheld(src) ? [notice(SENSITIVE_WITHHELD)] : []),
  ];
  return searchset(ctx, matches, supporting, paging, links(path, [], paging, matches.length), now, notices);
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
  const notices = [
    ...(src.dental === null && DENTAL_TYPES.includes(type) ? [notice(DENTAL_WITHHELD)] : []),
    ...(type === "Observation" && sensitiveWithheld(src) ? [notice(SENSITIVE_WITHHELD)] : []),
  ];
  return searchset(ctx, matches, [], params.paging, links(`${ctx.baseUrl}/${type}`, query, params.paging, matches.length), now, notices);
}

const IMPORTED = "Resources received from other systems (accepted FHIR imports) carry meta.tag record-source#external-import.";
const DENTAL = "Dental resources require dental.record.read (withheld otherwise, with an OperationOutcome notice); dental codes are local code systems.";
const TYPE_DOCUMENTATION: Partial<Record<CompartmentType, string>> = {
  ServiceRequest:
    "Laboratory tests ordered (category Laboratory), and referrals (category SNOMED CT 3457005 Patient referral; priority routine, urgent, or stat for an emergency referral; an outside provider as contained Organization/Practitioner, as written by the referrer; the platform's own status and urgency in notes).",
  Condition: `Diagnoses recorded in encounters, past conditions diagnosed elsewhere as reported (local category past-medical-history, always unconfirmed; never the problem list), and conditions from other systems (always unconfirmed). ${IMPORTED}`,
  AllergyIntolerance: `${IMPORTED} Imported allergies are always unconfirmed.`,
  Observation: `Vital signs, released laboratory results (performer: the organization, or a contained reference laboratory for a send-out), observations from other systems, dental observations (category exam: examinations, the current tooth chart, periodontal charts), and social history (category social-history, one per part of each version, local codes; substance use and sexual history also need history.read and encounter.write). ${IMPORTED} ${DENTAL}`,
  MedicationStatement: `Medication history from other systems only (never a prescription of this organization). ${IMPORTED}`,
  CarePlan: `Care plans, and dental treatment plans (category dental; the patient's decision per item as the activity's status reason). ${DENTAL}`,
  DocumentReference: `Available documents only (not archived ones; dental images with their kind, teeth and visit), and document descriptions from other systems (no content); requires document.read. ${IMPORTED}`,
  Procedure: `Performed dental procedures (the organization's own procedure codes; bodySite the FDI tooth and surfaces), and past procedures from the patient's history (local category past-procedure; reported ones tagged record-source#reported, the asserter who told the organization). ${IMPORTED} ${DENTAL}`,
  FamilyMemberHistory: `Relatives' conditions as reported (relationship in HL7 v3 RoleCode; age at onset; a cause of death as a condition that contributed to death). ${IMPORTED}`,
  Immunization: `Doses given here (primarySource true), not given (not-done with the reason), reported by the patient or another provider (primarySource false, reportOrigin as text) and accepted from imports. vaccineCode is the organization's own catalogue code (a local code system unless configured); partial dates at their precision. ${IMPORTED}`,
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
          description:
            "Bearer token of a staff account holding interop.fhir.read, with the organization selected; documents also need document.read, the dental record dental.record.read, substance use and sexual history history.read and encounter.write. Every access is audited.",
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
