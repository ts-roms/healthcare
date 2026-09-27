import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req, UseFilters } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { type Actor, BadRequestError, CurrentActor, NotFoundError, RequirePermissions } from "@healthcare/core";
import {
  type Bundle,
  type CapabilityStatement,
  capabilityStatement,
  type CompartmentType,
  type FhirResource,
  PATIENT_COMPARTMENT_TYPES,
  patientEverything,
  patientResources,
  searchByPatient,
} from "@healthcare/interoperability";
import type { Request } from "express";
import { FhirExceptionFilter } from "./fhir-exception.filter";
import { FhirRecordComposer } from "./fhir-record";

const FHIR_JSON = "application/fhir+json; charset=utf-8";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only FHIR R4 interface over patient records (docs/interoperability/fhir.md).
 * The internal model stays the source of truth; resources are mapped on request by
 * libs/interoperability. Requires interop.fhir.read; every access is audited with
 * the patient and what was returned. Errors are OperationOutcome resources.
 */
@ApiTags("fhir")
@ApiBearerAuth()
@ApiProduces("application/fhir+json")
@UseFilters(FhirExceptionFilter)
@RequirePermissions("interop.fhir.read")
@Controller({ path: "fhir/r4", version: "1" })
export class FhirController {
  constructor(
    private readonly composer: FhirRecordComposer,
    private readonly audit: AuditService,
  ) {}

  @Get("metadata")
  @Header("Content-Type", FHIR_JSON)
  @ApiOperation({ summary: "CapabilityStatement: what this read-only FHIR R4 interface supports" })
  async metadata(@CurrentActor() actor: Actor, @Req() request: Request): Promise<CapabilityStatement> {
    return capabilityStatement(await this.composer.context(actor.organizationId, baseUrl(request)));
  }

  @Get("Patient/:id")
  @Header("Content-Type", FHIR_JSON)
  @ApiOperation({ summary: "Read one Patient resource" })
  async readPatient(@CurrentActor() actor: Actor, @Req() request: Request, @Param("id", ParseUUIDPipe) patientId: string): Promise<FhirResource> {
    const ctx = await this.composer.context(actor.organizationId, baseUrl(request));
    const source = await this.composer.record(actor, patientId);
    await this.audited(actor, "fhir.patient-read", patientId, { resourceTypes: ["Patient"], resources: 1 });
    return patientResources(ctx, source).patient;
  }

  @Get("Patient/:id/$everything")
  @Header("Content-Type", FHIR_JSON)
  @ApiOperation({ summary: "Patient/$everything: the patient's whole record as a searchset Bundle" })
  async everything(@CurrentActor() actor: Actor, @Req() request: Request, @Param("id", ParseUUIDPipe) patientId: string): Promise<Bundle> {
    const ctx = await this.composer.context(actor.organizationId, baseUrl(request));
    const bundle = patientEverything(ctx, await this.composer.record(actor, patientId));
    const types = [...new Set((bundle.entry ?? []).map((e) => e.resource?.resourceType ?? ""))];
    await this.audited(actor, "fhir.patient-everything", patientId, { resourceTypes: types, resources: bundle.total ?? 0 });
    return bundle;
  }

  @Get(":type")
  @Header("Content-Type", FHIR_JSON)
  @ApiOperation({ summary: `Search one resource type by patient (${PATIENT_COMPARTMENT_TYPES.join(", ")}): ?patient=<id>` })
  async search(@CurrentActor() actor: Actor, @Req() request: Request, @Param("type") type: string, @Query("patient") patient?: string): Promise<Bundle> {
    if (!(PATIENT_COMPARTMENT_TYPES as readonly string[]).includes(type)) throw new NotFoundError(`FHIR resource type ${type}`);
    // Only patient-scoped searches: no open-ended queries across patients.
    const patientId = patient?.replace(/^Patient\//, "");
    if (!patientId || !UUID.test(patientId)) throw new BadRequestError("Search by patient: give ?patient=<patient id>");
    const ctx = await this.composer.context(actor.organizationId, baseUrl(request));
    const bundle = searchByPatient(ctx, await this.composer.record(actor, patientId), type as CompartmentType);
    await this.audited(actor, "fhir.search", patientId, { resourceTypes: [type], resources: bundle.total ?? 0 });
    return bundle;
  }

  private audited(actor: Actor, action: string, patientId: string, metadata: { resourceTypes: string[]; resources: number }) {
    return this.audit.recordStandalone(actor, { action, resourceType: "patient", resourceId: patientId, patientId, metadata });
  }
}

function baseUrl(request: Request): string {
  return `${request.protocol}://${request.get("host")}/api/v1/fhir/r4`;
}
