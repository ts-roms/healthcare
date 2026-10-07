import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { PatientMfaPolicyDto } from "../portal/portal.dto";
import { PortalMfaPolicyService } from "./portal-mfa-policy.service";

/** The organization's two-step verification requirement for patients (staff side; migration 0100). */
@ApiTags("users")
@ApiBearerAuth()
@Controller({ version: "1" })
export class PatientMfaPolicyController {
  constructor(private readonly policy: PortalMfaPolicyService) {}

  @Get("security/patient-mfa-policy")
  @RequirePermissions("user.read")
  @ApiOperation({ summary: "Whether patients must use two-step verification in MyHealth, from when, and how many have it" })
  view(@CurrentActor() actor: Actor) {
    return this.policy.view(actor.organizationId);
  }

  @Put("security/patient-mfa-policy")
  @RequirePermissions("user.mfa.manage")
  @ApiOperation({ summary: "Require two-step verification for patients from a date at least a week ahead, or stop requiring it" })
  update(@CurrentActor() actor: Actor, @Body() body: PatientMfaPolicyDto) {
    return this.policy.setPolicy(actor, body);
  }
}
