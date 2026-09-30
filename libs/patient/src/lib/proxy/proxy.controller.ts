import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, Public, RequirePermissions } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard } from "../portal/patient-access.guard";
import type { PortalPrincipal } from "../portal/portal-account.service";
import { GrantProxyDto, RevokeProxyDto } from "./proxy.dto";
import { PortalProxyService } from "./proxy.service";

/**
 * The account holder's own view of guardian access in MyHealth: who they may act for, who may act for them, and ending it.
 * Deliberately not `@ProxyAllowed()`: these are about the holder's own account, never reachable while acting for someone.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/proxy", version: "1" })
export class PortalProxyController {
  constructor(private readonly proxies: PortalProxyService) {}

  @Get("dependents")
  @ApiOperation({ summary: "The people this account holder may act for now" })
  dependents(@CurrentPatient() patient: PortalPrincipal) {
    return this.proxies.dependentsOf(patient);
  }

  @Get("guardians")
  @ApiOperation({ summary: "The people who may act for this account holder" })
  guardians(@CurrentPatient() patient: PortalPrincipal) {
    return this.proxies.guardiansOf(patient);
  }

  @Post("grants/:grantId/end")
  @HttpCode(204)
  @ApiOperation({ summary: "End a grant: the person acted for takes access back, or the guardian gives it up" })
  async end(@CurrentPatient() patient: PortalPrincipal, @Param("grantId", ParseUUIDPipe) grantId: string): Promise<void> {
    await this.proxies.endByPortal(patient, grantId);
  }
}

/** The clinic's side: give and end a guardian's access after checking their authority. */
@ApiTags("patients")
@ApiBearerAuth()
@Controller({ path: "patients/:patientId/portal-proxies", version: "1" })
export class PatientPortalProxyController {
  constructor(private readonly proxies: PortalProxyService) {}

  @Get()
  @RequirePermissions("patient.read")
  @ApiOperation({ summary: "Who may act for this patient in MyHealth, and whom this patient may act for (audited)" })
  overview(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.proxies.overview(actor, patientId);
  }

  @Post()
  @RequirePermissions("patient.portal.proxy.manage")
  @ApiOperation({ summary: "Give a guardian or caregiver access to this patient's MyHealth, after checking their authority in person" })
  grant(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: GrantProxyDto) {
    return this.proxies.grant(actor, patientId, body);
  }

  @Post(":grantId/revoke")
  @HttpCode(200)
  @RequirePermissions("patient.portal.proxy.manage")
  @ApiOperation({ summary: "End the access, with a reason" })
  revoke(
    @CurrentActor() actor: Actor,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("grantId", ParseUUIDPipe) grantId: string,
    @Body() body: RevokeProxyDto,
  ) {
    return this.proxies.revoke(actor, patientId, grantId, body.reason);
  }
}
