export * from "./lib/fhir/administrative";
export * from "./lib/fhir/bundle";
export * from "./lib/fhir/clinical";
export * from "./lib/fhir/orders";
export * from "./lib/fhir/sources";
export * from "./lib/fhir/terminology";
/** FHIR R4 resource types (from @types/fhir), re-exported so callers need not depend on the typings package. */
export type { Bundle, CapabilityStatement, FhirResource, OperationOutcome, Patient as FhirPatient } from "fhir/r4";
