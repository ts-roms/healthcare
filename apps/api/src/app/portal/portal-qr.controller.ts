import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, PatientQrService, ProxyAllowed, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * The patient's own check-in QR code in MyHealth. Public to the staff guard; the patient guard re-checks the session, account
 * and portal consent. A guardian acting for a dependent may show the dependent's code (`ProxyAllowed`). Audited with actor
 * type "patient", never with the key.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal/qr", version: "1" })
export class PortalQrController {
  constructor(private readonly qr: PatientQrService) {}

  @Get()
  @ApiOperation({ summary: "The patient's own check-in QR code, to show at the front desk (read-only; the clinic issues and replaces it)" })
  mine(@CurrentPatient() patient: PortalPrincipal) {
    return this.qr.portalCode(patientAuditContext(patient), patient.organizationId, patient.patientId);
  }
}
