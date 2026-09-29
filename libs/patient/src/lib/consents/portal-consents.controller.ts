import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard } from "../portal/patient-access.guard";
import type { PortalPrincipal } from "../portal/portal-account.service";
import { PortalConsentService } from "./portal-consents.service";

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

  @Post(":consentType/withdraw")
  @HttpCode(200)
  @ApiOperation({ summary: "Withdraw a consent MyHealth offers (withdrawing portal access ends MyHealth sessions)" })
  withdraw(@CurrentPatient() patient: PortalPrincipal, @Param("consentType") consentType: string) {
    return this.consents.withdraw(patient, consentType);
  }
}
