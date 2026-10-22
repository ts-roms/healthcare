import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { StaffTourSettingDto } from "./tour.dto";
import { StaffTourSettingService } from "./tour-setting.service";

/** Whether the organization offers the guided tour of the staff app. */
@ApiTags("organization")
@ApiBearerAuth()
@Controller({ path: "organization/tour-setting", version: "1" })
export class StaffTourSettingController {
  constructor(private readonly tour: StaffTourSettingService) {}

  @Get()
  @ApiOperation({ summary: "Whether the organization offers the guided tour (any signed-in member of staff; no patient data)" })
  get(@CurrentActor() actor: Actor) {
    return this.tour.get(actor.organizationId);
  }

  @Put()
  @RequirePermissions("organization.manage")
  @ApiOperation({ summary: "Switch the guided tour on or off for the whole organization (audited)" })
  set(@CurrentActor() actor: Actor, @Body() body: StaffTourSettingDto) {
    return this.tour.set(actor, body);
  }
}
