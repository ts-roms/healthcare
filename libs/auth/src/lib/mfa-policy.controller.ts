import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { MfaExemptionDto, MfaPolicyDto, MfaResetDto } from "./mfa-policy.dto";
import { MfaPolicyService } from "./mfa-policy.service";

@ApiTags("users")
@ApiBearerAuth()
@Controller({ version: "1" })
export class MfaPolicyController {
  constructor(private readonly policy: MfaPolicyService) {}

  @Get("security/mfa-policy")
  @RequirePermissions("user.read")
  @ApiOperation({ summary: "Whether staff must use two-step verification, who has it, who still needs it and who is exempt" })
  view(@CurrentActor() actor: Actor) {
    return this.policy.view(actor.organizationId);
  }

  @Put("security/mfa-policy")
  @RequirePermissions("user.mfa.manage")
  @ApiOperation({ summary: "Require two-step verification for staff, or stop requiring it (turning it on needs your own first)" })
  update(@CurrentActor() actor: Actor, @Body() body: MfaPolicyDto) {
    return this.policy.setPolicy(actor, body);
  }

  @Put("users/:userId/mfa-exemption")
  @RequirePermissions("user.mfa.manage")
  @ApiOperation({ summary: "Exempt a member (e.g. an integration account) from the two-step verification requirement, with a reason" })
  exempt(@CurrentActor() actor: Actor, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: MfaExemptionDto) {
    return this.policy.exempt(actor, userId, body);
  }

  @Delete("users/:userId/mfa-exemption")
  @RequirePermissions("user.mfa.manage")
  removeExemption(@CurrentActor() actor: Actor, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.policy.removeExemption(actor, userId);
  }

  @Post("users/:userId/mfa-reset")
  @HttpCode(204)
  @RequirePermissions("user.mfa.manage")
  @ApiOperation({ summary: "Turn off a member's two-step verification (lost phone) and end their sessions; they set it up again" })
  async reset(@CurrentActor() actor: Actor, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: MfaResetDto): Promise<void> {
    await this.policy.reset(actor, userId, body);
  }
}
