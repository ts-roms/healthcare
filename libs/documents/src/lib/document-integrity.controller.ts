import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { IntegrityFindingsQueryDto, IntegrityRunDto, ResolveIntegrityFindingDto } from "./document.dto";
import { DocumentIntegrityService } from "./document-integrity.service";

/** The integrity review of stored documents against their checksums, and what it found (nothing is repaired or deleted). */
@ApiTags("documents")
@ApiBearerAuth()
@Controller({ path: "document-integrity", version: "1" })
export class DocumentIntegrityController {
  constructor(private readonly integrity: DocumentIntegrityService) {}

  @Get("runs")
  @RequirePermissions("document.integrity.manage")
  @ApiOperation({ summary: "Recent integrity reviews (status and counts) and how many findings are open (audited)" })
  list(@CurrentActor() actor: Actor) {
    return this.integrity.list(actor);
  }

  @Post("runs")
  @HttpCode(202)
  @RequirePermissions("document.integrity.manage")
  @ApiOperation({ summary: "Start a review of the organization's available documents (or one category) against their recorded checksums, in the background" })
  request(@CurrentActor() actor: Actor, @Body() body: IntegrityRunDto) {
    return this.integrity.request(actor, body);
  }

  @Get("runs/:runId")
  @RequirePermissions("document.integrity.manage")
  get(@CurrentActor() actor: Actor, @Param("runId", ParseUUIDPipe) runId: string) {
    return this.integrity.get(actor, runId);
  }

  @Post("runs/:runId/cancel")
  @HttpCode(200)
  @RequirePermissions("document.integrity.manage")
  @ApiOperation({ summary: "Stop a queued or running review where it is" })
  cancel(@CurrentActor() actor: Actor, @Param("runId", ParseUUIDPipe) runId: string) {
    return this.integrity.cancel(actor, runId);
  }

  @Get("findings")
  @RequirePermissions("document.integrity.manage")
  @ApiOperation({ summary: "Documents whose stored bytes did not verify: open (withheld from readers) or resolved (audited)" })
  findings(@CurrentActor() actor: Actor, @Query() query: IntegrityFindingsQueryDto) {
    return this.integrity.findings(actor, query.status);
  }

  @Post("findings/:findingId/resolve")
  @HttpCode(200)
  @RequirePermissions("document.integrity.manage")
  @ApiOperation({ summary: "Record the records office's decision about a finding; the document serves again (archive it with a reason to take it out of use)" })
  resolve(@CurrentActor() actor: Actor, @Param("findingId", ParseUUIDPipe) findingId: string, @Body() body: ResolveIntegrityFindingDto) {
    return this.integrity.resolve(actor, findingId, body.note);
  }
}
