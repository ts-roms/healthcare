import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard } from "../portal/patient-access.guard";
import type { PortalPrincipal } from "../portal/portal-account.service";
import { PortalPreferencesService, portalPreferencesSchema } from "./portal-preferences.service";

export class PortalPreferencesDto extends createZodDto(portalPreferencesSchema) {}

/** The patient's notification settings in MyHealth. Public to the staff guard; the patient guard protects every request. */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/communication-preferences", version: "1" })
export class PortalPreferencesController {
  constructor(private readonly preferences: PortalPreferencesService) {}

  @Get()
  @ApiOperation({ summary: "Which messages the clinic may send by text message and email, and where they would go (masked)" })
  get(@CurrentPatient() patient: PortalPrincipal) {
    return this.preferences.get(patient);
  }

  @Put()
  @ApiOperation({ summary: "Choose which messages the clinic may send by text message and email; applies to the next message" })
  set(@CurrentPatient() patient: PortalPrincipal, @Body() body: PortalPreferencesDto) {
    return this.preferences.set(patient, body);
  }
}
