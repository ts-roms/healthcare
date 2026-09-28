import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, pdfFile, RequireFacility, requireFacilityId, RequirePermissions } from "@healthcare/core";
import { CatalogQueryDto } from "../laboratory.dto";
import { ReferenceLabService } from "./reference-lab.service";
import {
  CancelSendOutDto,
  CreateReferenceLabDto,
  DispatchDto,
  ListSendOutsDto,
  PrepareSendOutDto,
  ReferenceRejectDto,
  RemoveReferralDto,
  ResultsReceivedDto,
  SetReferralDto,
  UpdateReferenceLabDto,
} from "./send-out.dto";
import { SendOutManifestService } from "./send-out-manifest";
import { SendOutService } from "./send-out.service";

const uuid = new ParseUUIDPipe();

/** Reference laboratories (organization) and the tests each facility refers out. */
@ApiTags("laboratory")
@ApiBearerAuth()
@Controller({ path: "laboratory", version: "1" })
export class ReferenceLabController {
  constructor(private readonly referenceLabs: ReferenceLabService) {}

  @Get("reference-labs")
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "Reference laboratories the organization sends tests to (accreditation reference as recorded; not verified)" })
  list(@CurrentActor() actor: Actor, @Query() query: CatalogQueryDto) {
    return this.referenceLabs.list(actor.organizationId, query.includeInactive === "true");
  }

  @Post("reference-labs")
  @RequirePermissions("lab.catalog.manage")
  create(@CurrentActor() actor: Actor, @Body() body: CreateReferenceLabDto) {
    return this.referenceLabs.create(actor, body);
  }

  @Patch("reference-labs/:id")
  @RequirePermissions("lab.catalog.manage")
  update(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: UpdateReferenceLabDto) {
    return this.referenceLabs.update(actor, id, body);
  }

  @Get("referrals")
  @RequireFacility()
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "Tests the selected facility's laboratory refers out, and to which reference laboratory" })
  referrals(@CurrentActor() actor: Actor) {
    return this.referenceLabs.referrals(actor.organizationId, requireFacilityId(actor));
  }

  @Put("referrals/:testId")
  @RequireFacility()
  @RequirePermissions("lab.catalog.manage")
  @ApiOperation({ summary: "Refer a test out from the selected facility (received specimens of it are prepared for send-out)" })
  setReferral(@CurrentActor() actor: Actor, @Param("testId", uuid) testId: string, @Body() body: SetReferralDto) {
    return this.referenceLabs.setReferral(actor, requireFacilityId(actor), testId, body);
  }

  @Delete("referrals/:testId")
  @RequireFacility()
  @RequirePermissions("lab.catalog.manage")
  @ApiOperation({ summary: "Stop referring a test out from the selected facility (tests already sent out are not affected)" })
  removeReferral(@CurrentActor() actor: Actor, @Param("testId", uuid) testId: string, @Body() body: RemoveReferralDto) {
    return this.referenceLabs.removeReferral(actor, requireFacilityId(actor), testId, body.reason);
  }
}

/** Send-outs: preparation, dispatch with a manifest, results back, rejection by the reference laboratory, cancellation. */
@ApiTags("laboratory")
@ApiBearerAuth()
@Controller({ path: "laboratory", version: "1" })
export class SendOutController {
  constructor(
    private readonly sendOuts: SendOutService,
    private readonly manifests: SendOutManifestService,
  ) {}

  @Get("send-outs")
  @RequireFacility()
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "The facility's send-outs: to dispatch, awaiting results (with turnaround), closed, or all" })
  list(@CurrentActor() actor: Actor, @Query() query: ListSendOutsDto) {
    return this.sendOuts.list(actor, query.view);
  }

  @Post("send-outs")
  @RequireFacility()
  @RequirePermissions("lab.specimen.receive")
  @ApiOperation({ summary: "Refer received tests to a reference laboratory by hand (configured referrals are prepared on receipt)" })
  prepare(@CurrentActor() actor: Actor, @Body() body: PrepareSendOutDto) {
    return this.sendOuts.prepare(actor, body);
  }

  @Post("send-outs/:id/results-received")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.specimen.receive")
  @ApiOperation({ summary: "The reference laboratory's results came back (its accession number); the results can then be entered and signed off" })
  resultsReceived(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: ResultsReceivedDto) {
    return this.sendOuts.resultsReceived(actor, id, body);
  }

  @Post("send-outs/:id/reject")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.specimen.reject")
  @ApiOperation({ summary: "Record that the reference laboratory rejected the specimen, with its reason" })
  reject(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: ReferenceRejectDto) {
    return this.sendOuts.referenceRejected(actor, id, body);
  }

  @Post("send-outs/:id/cancel")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.specimen.receive")
  @ApiOperation({ summary: "Cancel a send-out that has not been answered (e.g. to test in-house)" })
  cancel(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: CancelSendOutDto) {
    return this.sendOuts.cancel(actor, id, body.reason);
  }

  @Post("send-out-dispatches")
  @RequireFacility()
  @RequirePermissions("lab.specimen.receive")
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiOperation({ summary: "Record the handover of prepared send-outs to one reference laboratory (courier, reference, time): assigns the manifest number" })
  dispatch(@CurrentActor() actor: Actor, @Body() body: DispatchDto) {
    return this.sendOuts.dispatch(actor, body);
  }

  @Get("send-out-dispatches")
  @RequireFacility()
  @RequirePermissions("lab.order.read")
  dispatches(@CurrentActor() actor: Actor) {
    return this.sendOuts.dispatches(actor);
  }

  @Get("send-out-dispatches/:id")
  @RequirePermissions("lab.order.read")
  dispatchDetail(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.sendOuts.dispatchDetail(actor, id);
  }

  @Get("send-out-dispatches/:id/manifest.pdf")
  @RequireFacility()
  @RequirePermissions("lab.specimen.receive")
  @ApiOperation({ summary: "The dispatch's manifest (PDF): specimens with minimal identification, handover signatures (audited)" })
  async manifest(@CurrentActor() actor: Actor, @Param("id", uuid) id: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.manifests.manifest(actor, id);
    return pdfFile(pdf, filename);
  }
}
