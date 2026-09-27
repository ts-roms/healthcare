import type { Bundle, BundleEntry, CapabilityStatement, FhirResource, OperationOutcome } from "fhir/r4";
import { toLocation, toOrganization, toPatient, toPractitioner } from "./administrative";
import { toAllergyIntolerance, toAppointment, toCondition, toEncounter, toNoKnownAllergies, toVitalSignObservations } from "./clinical";
import { toCarePlan, toDiagnosticReport, toLabObservation, toMedicationRequests, toServiceRequests } from "./orders";
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
  "CarePlan",
] as const;
export type CompartmentType = (typeof PATIENT_COMPARTMENT_TYPES)[number];

/** Every resource of one patient's record, the patient first; shared resources (organization, facilities, practitioners) after. */
export function patientResources(ctx: FhirContext, src: PatientRecordSource): { patient: FhirResource; clinical: FhirResource[]; supporting: FhirResource[] } {
  const patientId = src.patient.id;
  const clinical: FhirResource[] = [];
  for (const e of src.encounters) clinical.push(toEncounter(ctx, patientId, e, src.diagnoses));
  for (const d of src.diagnoses) clinical.push(toCondition(ctx, patientId, d));
  for (const a of src.allergies) clinical.push(toAllergyIntolerance(patientId, a));
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

  const supporting: FhirResource[] = [
    toOrganization(ctx),
    ...src.facilities.map((f) => toLocation(ctx, f)),
    ...src.practitioners.map((p) => toPractitioner(ctx, p)),
  ];
  return { patient: toPatient(ctx, src.patient), clinical, supporting };
}

function entry(ctx: FhirContext, resource: FhirResource, mode: "match" | "include"): BundleEntry {
  return { fullUrl: `${ctx.baseUrl}/${resource.resourceType}/${resource.id}`, resource, search: { mode } };
}

function bundle(entries: BundleEntry[], total: number, self: string, now: Date): Bundle {
  return {
    resourceType: "Bundle",
    type: "searchset",
    timestamp: now.toISOString(),
    total,
    link: [{ relation: "self", url: self }],
    entry: entries,
  };
}

/** Patient/$everything: the patient's whole record as a searchset Bundle. */
export function patientEverything(ctx: FhirContext, src: PatientRecordSource, now = new Date()): Bundle {
  const { patient, clinical, supporting } = patientResources(ctx, src);
  const matches = [patient, ...clinical];
  return bundle(
    [...matches.map((r) => entry(ctx, r, "match")), ...supporting.map((r) => entry(ctx, r, "include"))],
    matches.length,
    `${ctx.baseUrl}/Patient/${src.patient.id}/$everything`,
    now,
  );
}

/** A search by patient for one resource type (e.g. Observation?patient=…). */
export function searchByPatient(ctx: FhirContext, src: PatientRecordSource, type: CompartmentType, now = new Date()): Bundle {
  const { clinical } = patientResources(ctx, src);
  const matches = clinical.filter((r) => r.resourceType === type);
  return bundle(
    matches.map((r) => entry(ctx, r, "match")),
    matches.length,
    `${ctx.baseUrl}/${type}?patient=${src.patient.id}`,
    now,
  );
}

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
        resource: [
          {
            type: "Patient",
            interaction: [{ code: "read" }],
            operation: [{ name: "everything", definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything" }],
          },
          ...PATIENT_COMPARTMENT_TYPES.map((type) => ({
            type,
            interaction: [{ code: "search-type" as const }],
            searchParam: [{ name: "patient", type: "reference" as const, documentation: "Required: the patient's id" }],
          })),
        ],
      },
    ],
  };
}

/** A FHIR error body. */
export function operationOutcome(
  code: "not-found" | "forbidden" | "invalid" | "login" | "exception" | "not-supported" | "throttled",
  diagnostics: string,
): OperationOutcome {
  return { resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics }] };
}
