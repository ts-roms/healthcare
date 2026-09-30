import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { PatientHistoryService } from "@healthcare/clinic";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, ProxyAllowed, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * The patient's health history in MyHealth (read-only): past procedures and conditions, family history and the current
 * social history, as the clinic recorded them — no staff notes and not who recorded them; entries in error left out.
 * Substance use and sexual history are shown to the patient themself, never to someone acting for them
 * (`sensitiveWithheld`). Public to the staff guard; the patient guard re-checks the session, account and portal
 * consent; a guardian acting for a dependent may read the rest (`ProxyAllowed`). Audited with actor type "patient".
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal", version: "1" })
export class PortalHistoryController {
  constructor(
    private readonly history: PatientHistoryService,
    private readonly audit: AuditService,
  ) {}

  @Get("health-history")
  @ApiOperation({ summary: "The patient's health history as recorded by the clinic (read-only)" })
  async read(@CurrentPatient() patient: PortalPrincipal) {
    const sensitive = !patient.proxy;
    const view = await this.history.patientView(patient.organizationId, patient.patientId, { sensitive });
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.health-history-view",
      resourceType: "patient_history",
      patientId: patient.patientId,
      metadata: {
        sensitiveShown: sensitive,
        counts: { procedures: view.procedures.length, conditions: view.conditions.length, medications: view.medications.length, family: view.family.entries.length },
      },
    });
    return view;
  }
}
