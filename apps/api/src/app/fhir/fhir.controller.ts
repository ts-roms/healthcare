import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Redirect, Req, UseFilters } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { type Actor, BadRequestError, CurrentActor, ForbiddenError, NotFoundError, RequirePermissions } from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import {
  type Bundle,
  type CapabilityStatement,
  capabilityStatement,
  type CompartmentType,
  type FhirResource,
  FhirSearchError,
  LAST_UPDATED_TYPES,
  PATIENT_COMPARTMENT_TYPES,
  parsePaging,
  parseSearchParameters,
  patientEverything,
  patientResources,
  searchByPatient,
} from "@healthcare/interoperability";
import type { Request } from "express";
import { FhirExceptionFilter } from "./fhir-exception.filter";
import { canReadDocuments, FhirRecordComposer } from "./fhir-record";

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
    private readonly documents: DocumentsService,
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
    await this.audit.recordStandalone(actor, {
      action: "fhir.patient-read",
      resourceType: "patient",
      resourceId: patientId,
      patientId,
      metadata: { resourceTypes: ["Patient"], resources: 1 },
    });
    return patientResources(ctx, source).patient;
  }

  @Get("Patient/:id/$everything")
  @Header("Content-Type", FHIR_JSON)
  @ApiOperation({ summary: "Patient/$everything: the patient's whole record as a searchset Bundle, paged with _count and _offset" })
  async everything(
    @CurrentActor() actor: Actor,
    @Req() request: Request,
    @Param("id", ParseUUIDPipe) patientId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<Bundle> {
    for (const name of ["_since", "_lastUpdated", "_type", "start", "end"]) {
      if (query[name] !== undefined) throw new FhirSearchError(`Patient/$everything does not support ${name}`, "not-supported");
    }
    const paging = parsePaging(query);
    const ctx = await this.composer.context(actor.organizationId, baseUrl(request));
    const bundle = patientEverything(ctx, await this.composer.record(actor, patientId), paging);
    await this.audited(actor, "fhir.patient-everything", patientId, bundle, paging);
    return bundle;
  }

  @Get("Binary/:id")
  @Redirect()
  @ApiOperation({ summary: "A DocumentReference's content: redirects to a short-lived signed download (requires document.read; audited)" })
  async binary(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) documentId: string): Promise<{ url: string; statusCode: number }> {
    if (!canReadDocuments(actor)) throw new ForbiddenError("Reading document content requires document.read");
    // Only patient documents that are available: the same set DocumentReference exports.
    const document = await this.documents.get(actor, documentId);
    if (!document.patientId || document.status !== "available") throw new NotFoundError("Document");
    const { url } = await this.documents.downloadUrl(actor, documentId); // audited as document.download
    return { url, statusCode: 302 };
  }

  @Get(":type")
  @Header("Content-Type", FHIR_JSON)
  @ApiOperation({
    summary: `Search one resource type by patient (${PATIENT_COMPARTMENT_TYPES.join(", ")}): ?patient=<id>, paged with _count and _offset; _lastUpdated=ge…/le… for ${LAST_UPDATED_TYPES.join(", ")}`,
  })
  async search(@CurrentActor() actor: Actor, @Req() request: Request, @Param("type") type: string, @Query() query: Record<string, unknown>): Promise<Bundle> {
    if (!(PATIENT_COMPARTMENT_TYPES as readonly string[]).includes(type)) throw new NotFoundError(`FHIR resource type ${type}`);
    const compartmentType = type as CompartmentType;
    // Only patient-scoped searches: no open-ended queries across patients.
    const patientId = typeof query["patient"] === "string" ? query["patient"].replace(/^Patient\//, "") : undefined;
    if (!patientId || !UUID.test(patientId)) throw new BadRequestError("Search by patient: give ?patient=<patient id>");
    const params = parseSearchParameters(query, { type, lastUpdated: LAST_UPDATED_TYPES.includes(compartmentType) });
    if (compartmentType === "DocumentReference" && !canReadDocuments(actor)) throw new ForbiddenError("Searching documents requires document.read");
    const ctx = await this.composer.context(actor.organizationId, baseUrl(request));
    const bundle = searchByPatient(ctx, await this.composer.record(actor, patientId), compartmentType, params);
    await this.audited(actor, "fhir.search", patientId, bundle, params.paging, params.lastUpdated);
    return bundle;
  }

  /** Audits what was disclosed: the page's resource types and matches, with the full total and the page asked for. */
  private audited(actor: Actor, action: string, patientId: string, bundle: Bundle, paging: { count: number; offset: number }, lastUpdated?: object) {
    const matches = (bundle.entry ?? []).filter((e) => e.search?.mode === "match");
    const metadata = {
      resourceTypes: [...new Set(matches.map((e) => e.resource?.resourceType ?? ""))],
      resources: matches.length,
      total: bundle.total ?? 0,
      count: paging.count,
      offset: paging.offset,
      ...(lastUpdated && Object.keys(lastUpdated).length > 0 ? { lastUpdated } : {}),
    };
    return this.audit.recordStandalone(actor, { action, resourceType: "patient", resourceId: patientId, patientId, metadata });
  }
}

function baseUrl(request: Request): string {
  return `${request.protocol}://${request.get("host")}/api/v1/fhir/r4`;
}
