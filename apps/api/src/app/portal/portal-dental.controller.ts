import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { ForbiddenError, Public } from "@healthcare/core";
import { DentalPatientAccess, PatientPlanDecisionDto } from "@healthcare/dental";
import { CurrentPatient, PatientAccessGuard, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * The patient's dental record in MyHealth — only when their organization turned MyHealth dental records on (dental
 * settings), and only what is patient-facing: treatment plans (items, the patient's decision, status), completed
 * procedures, the current tooth chart and the images a dentist released. Examination notes, periodontal measurements,
 * remarks, unreleased images and anything entered in error are never returned (`DentalPatientAccess`). When the
 * organization also allows it, the patient accepts or declines plan items awaiting their decision here. The patient guard re-checks the session, account and
 * portal consent on every request; each read of the record is audited with actor type "patient".
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/dental", version: "1" })
export class PortalDentalController {
  constructor(
    private readonly dental: DentalPatientAccess,
    private readonly audit: AuditService,
  ) {}

  /** For the navigation: a yes/no without clinical content (like the unread-message count, not audited). */
  @Get("availability")
  @ApiOperation({ summary: "Whether MyHealth offers a dental section: the clinic shares dental records and there is something to show" })
  async availability(@CurrentPatient() patient: PortalPrincipal) {
    return { available: await this.dental.available(patient.organizationId, patient.patientId) };
  }

  @Get("record")
  @ApiOperation({ summary: "The patient's treatment plans, completed dental procedures and current tooth chart (only when the clinic shares them)" })
  async record(@CurrentPatient() patient: PortalPrincipal) {
    const record = await this.dental.record(patient.organizationId, patient.patientId);
    if (!record) {
      await this.audit.recordStandalone(patientAuditContext(patient), {
        action: "portal.dental-view",
        resourceType: "patient",
        resourceId: patient.patientId,
        patientId: patient.patientId,
        outcome: "denied",
        reason: "Dental records are not shared in MyHealth",
      });
      throw new ForbiddenError("Your clinic does not share dental records in MyHealth");
    }
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.dental-view",
      resourceType: "patient",
      resourceId: patient.patientId,
      patientId: patient.patientId,
      metadata: { plans: record.plans.length, procedures: record.procedures.length, teeth: record.chart.length },
    });
    return record;
  }

  @Get("images/:imageId/link")
  @ApiOperation({ summary: "A short-lived link to a dental image the dentist shared (audited as the patient's access)" })
  imageLink(@CurrentPatient() patient: PortalPrincipal, @Param("imageId", ParseUUIDPipe) imageId: string) {
    return this.dental.imageLink(patientAuditContext(patient), imageId);
  }

  @Post("plans/:planId/decision")
  @ApiOperation({
    summary: "Accept the listed items of a plan awaiting the patient's decision (others declined), after confirming the clinic's acknowledgement",
  })
  decide(@CurrentPatient() patient: PortalPrincipal, @Param("planId", ParseUUIDPipe) planId: string, @Body() body: PatientPlanDecisionDto) {
    return this.dental.decidePlan(patientAuditContext(patient), planId, body);
  }
}
