import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { ImmunizationService } from "@healthcare/clinic";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, ProxyAllowed, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * The patient's immunization history in MyHealth: doses given (here or elsewhere, as reported or imported), with the
 * vaccine, dose, date at its precision and where it was given. Not shown: doses not given, entries in error, staff
 * notes, lot details and who recorded them. Public to the staff guard; the patient guard re-checks the session,
 * account and portal consent; a guardian acting for a dependent may read it (`ProxyAllowed`). Audited with actor type "patient".
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal", version: "1" })
export class PortalImmunizationsController {
  constructor(
    private readonly immunizations: ImmunizationService,
    private readonly audit: AuditService,
  ) {}

  @Get("immunizations")
  @ApiOperation({ summary: "The patient's immunization history (doses given, newest first)" })
  async list(@CurrentPatient() patient: PortalPrincipal) {
    const items = await this.immunizations.patientView(patient.organizationId, patient.patientId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.immunizations-view",
      resourceType: "immunization",
      patientId: patient.patientId,
      metadata: { count: items.length },
    });
    return items;
  }
}
