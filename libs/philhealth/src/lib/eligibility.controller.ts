import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { ListEligibilityDto, RecordEligibilityDto, RequestEligibilityDto } from "./eligibility.dto";
import { PhilHealthEligibilityService } from "./eligibility.service";

@ApiTags("philhealth")
@ApiBearerAuth()
@RequirePermissions("philhealth.eligibility.manage")
@Controller({ path: "philhealth/eligibility", version: "1" })
export class PhilHealthEligibilityController {
  constructor(private readonly eligibility: PhilHealthEligibilityService) {}

  @Get()
  @ApiOperation({ summary: "A patient's PhilHealth eligibility checks and, for a date of service, what an inquiry would need" })
  list(@CurrentActor() actor: Actor, @Query() query: ListEligibilityDto) {
    return this.eligibility.list(actor, query.patientId, query.serviceDate);
  }

  @Post("records")
  @ApiOperation({ summary: "Record the answer PhilHealth's own channel gave (with its reference); answers are never changed" })
  record(@CurrentActor() actor: Actor, @Body() body: RecordEligibilityDto) {
    return this.eligibility.record(actor, body);
  }

  @Post("checks")
  @HttpCode(202)
  @ApiOperation({ summary: "Ask PhilHealth through the adapter (refused while the eligibility integration is a dependency)" })
  request(@CurrentActor() actor: Actor, @Body() body: RequestEligibilityDto) {
    return this.eligibility.request(actor, body);
  }
}
