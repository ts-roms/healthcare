import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { ListImportsDto, MatchPatientDto, RegisterFromImportDto, RejectEntryDto, RejectImportDto } from "./fhir-import.dto";
import { FhirImportService } from "./fhir-import.service";

/**
 * Staff review of FHIR imports (the receiving endpoint is POST /api/v1/fhir/r4/imports). Every view, match, accept
 * and reject is audited. See docs/interoperability/fhir.md ("Inbound").
 */
@ApiTags("fhir imports")
@ApiBearerAuth()
@RequirePermissions("interop.fhir.import.review")
@Controller({ path: "fhir-imports", version: "1" })
export class FhirImportController {
  constructor(private readonly imports: FhirImportService) {}

  @Get()
  @ApiOperation({ summary: "Received imports, those awaiting review first (metadata only)" })
  list(@CurrentActor() actor: Actor, @Query() query: ListImportsDto) {
    return this.imports.list(actor, query.status);
  }

  @Get(":importId")
  @ApiOperation({ summary: "One import: each entry in readable form, its outcome and what accepting it creates" })
  get(@CurrentActor() actor: Actor, @Param("importId", ParseUUIDPipe) importId: string) {
    return this.imports.get(actor, importId);
  }

  @Get(":importId/candidates")
  @ApiOperation({ summary: "Existing patients that may be the imported Patient (the patient domain's duplicate detection)" })
  candidates(@CurrentActor() actor: Actor, @Param("importId", ParseUUIDPipe) importId: string) {
    return this.imports.candidates(actor, importId);
  }

  @Post(":importId/match")
  @HttpCode(200)
  @ApiOperation({ summary: "Match the import to an existing patient (nothing is linked automatically)" })
  match(@CurrentActor() actor: Actor, @Param("importId", ParseUUIDPipe) importId: string, @Body() body: MatchPatientDto) {
    return this.imports.match(actor, importId, body);
  }

  @Post(":importId/register-patient")
  @HttpCode(200)
  @ApiOperation({ summary: "Register a new patient from the imported Patient (normal duplicate review; also requires patient.register) and match it" })
  register(@CurrentActor() actor: Actor, @Param("importId", ParseUUIDPipe) importId: string, @Body() body: RegisterFromImportDto) {
    return this.imports.registerPatient(actor, importId, body);
  }

  @Post(":importId/entries/:entryId/accept")
  @HttpCode(200)
  @ApiOperation({ summary: "Accept one entry: recorded by the owning domain for the matched patient, marked as from an external source" })
  accept(@CurrentActor() actor: Actor, @Param("importId", ParseUUIDPipe) importId: string, @Param("entryId", ParseUUIDPipe) entryId: string) {
    return this.imports.accept(actor, importId, entryId);
  }

  @Post(":importId/entries/:entryId/reject")
  @HttpCode(200)
  @ApiOperation({ summary: "Reject one entry, with a reason" })
  reject(
    @CurrentActor() actor: Actor,
    @Param("importId", ParseUUIDPipe) importId: string,
    @Param("entryId", ParseUUIDPipe) entryId: string,
    @Body() body: RejectEntryDto,
  ) {
    return this.imports.reject(actor, importId, entryId, body.reason);
  }

  @Post(":importId/reject")
  @HttpCode(200)
  @ApiOperation({ summary: "Reject every entry still pending, with a reason, and close the import" })
  rejectImport(@CurrentActor() actor: Actor, @Param("importId", ParseUUIDPipe) importId: string, @Body() body: RejectImportDto) {
    return this.imports.rejectImport(actor, importId, body);
  }
}
