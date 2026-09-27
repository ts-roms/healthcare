import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '@healthcare/audit';
import { CarePlanService } from '@healthcare/care-plan';
import { ClinicQueries } from '@healthcare/clinic';
import { type Actor, CurrentActor, NotFoundError, RequirePermissions } from '@healthcare/core';
import { PatientRecordService } from '@healthcare/patient';
import { PrescriptionService } from '@healthcare/prescription';

/**
 * Patient 360 (CLAUDE.md §39): one read model composed from several domains
 * at the application layer, so no domain library depends on another.
 */
@ApiTags('patients')
@ApiBearerAuth()
@Controller({ path: 'patients', version: '1' })
export class PatientSummaryController {
  constructor(
    private readonly patients: PatientRecordService,
    private readonly clinic: ClinicQueries,
    private readonly prescriptions: PrescriptionService,
    private readonly carePlans: CarePlanService,
    private readonly audit: AuditService,
  ) {}

  @Get(':patientId/summary')
  @RequirePermissions('patient.read', 'clinical.read')
  @ApiOperation({ summary: 'Patient 360: identity, alerts (allergies), problem list, medications, care plans, recent care, upcoming visits' })
  async summary(@CurrentActor() actor: Actor, @Param('patientId', ParseUUIDPipe) patientId: string) {
    const briefs = await this.patients.briefs(actor.organizationId, [patientId]);
    const patient = briefs.get(patientId);
    if (!patient) throw new NotFoundError('Patient');
    const canSeePrescriptions = actor.permissions.has('prescription.read');
    const canSeeCarePlans = actor.permissions.has('care-plan.read');
    const [clinical, medications, carePlans] = await Promise.all([
      this.clinic.clinicalSummary(actor.organizationId, patientId),
      canSeePrescriptions ? this.prescriptions.activeForPatient(actor.organizationId, patientId) : Promise.resolve(null),
      canSeeCarePlans ? this.carePlans.openPlansSummary(actor.organizationId, patientId) : Promise.resolve(null),
    ]);
    await this.audit.recordStandalone(actor, {
      action: 'patient.summary-view',
      resourceType: 'patient',
      resourceId: patientId,
      patientId,
      metadata: { sections: ['clinical', ...(medications ? ['prescriptions'] : []), ...(carePlans ? ['care_plans'] : [])] },
    });
    return { patient: { id: patientId, ...patient }, ...clinical, activePrescriptions: medications, openCarePlans: carePlans };
  }
}
