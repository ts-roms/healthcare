import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard } from "../portal/patient-access.guard";
import type { PortalPrincipal } from "../portal/portal-account.service";
import { PortalConsentService } from "./portal-consents.service";

class GiveConsentDto extends createZodDto(
  z.object({ consentTextId: z.uuid(), acknowledged: z.literal(true, { error: "Confirm that you have read and understood the wording" }) }),
) {}

/**
 * The patient's consents in MyHealth. Public to the staff guard; the patient guard re-checks the session, account and
 * portal consent on every request. Reads and withdrawals are audited with actor type "patient".
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/consents", version: "1" })
export class PortalConsentsController {
  constructor(private readonly consents: PortalConsentService) {}

  @Get()
  @ApiOperation({ summary: "The patient's consents: current decision, history, and which MyHealth can withdraw" })
  list(@CurrentPatient() patient: PortalPrincipal) {
    return this.consents.list(patient);
  }

  @Get(":consentType/wording")
  @ApiOperation({ summary: "The organization's wording of a consent it offers online (audited); 404 when it does not" })
  wording(@CurrentPatient() patient: PortalPrincipal, @Param("consentType") consentType: string) {
    return this.consents.wording(patient, consentType);
  }

  @Post(":consentType/give")
  @HttpCode(200)
  @ApiOperation({ summary: "Give a consent the organization offers online, having read its wording (records the version the patient saw)" })
  give(@CurrentPatient() patient: PortalPrincipal, @Param("consentType") consentType: string, @Body() body: GiveConsentDto) {
    return this.consents.give(patient, consentType, body.consentTextId);
  }

  @Post(":consentType/withdraw")
  @HttpCode(200)
  @ApiOperation({ summary: "Withdraw a consent MyHealth offers (withdrawing portal access ends MyHealth sessions)" })
  withdraw(@CurrentPatient() patient: PortalPrincipal, @Param("consentType") consentType: string) {
    return this.consents.withdraw(patient, consentType);
  }
}
