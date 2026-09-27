import { Controller, Get, Param, ParseUUIDPipe, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { CarePlanService } from "@healthcare/care-plan";
import { ClinicQueries } from "@healthcare/clinic";
import { pdfFile, Public } from "@healthcare/core";
import { LabPatientAccess, LabReportService } from "@healthcare/laboratory";
import { CurrentPatient, PatientAccessGuard, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";
import { PrescriptionService } from "@healthcare/prescription";

/**
 * The patient's own records in the portal (CLAUDE.md §17), composed here from
 * the domains' patient-facing queries. Public to the staff guard; the patient
 * guard re-checks the session, account and portal consent on every request.
 * Each read is audited with actor type "patient". Only what is meant for the
 * patient is returned: released, patient-releasable results; no staff names
 * beyond the practitioner; no internal notes.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal", version: "1" })
export class PortalRecordsController {
  constructor(
    private readonly clinic: ClinicQueries,
    private readonly lab: LabPatientAccess,
    private readonly labReports: LabReportService,
    private readonly prescriptions: PrescriptionService,
    private readonly carePlans: CarePlanService,
    private readonly audit: AuditService,
  ) {}

  @Get("appointments")
  @ApiOperation({ summary: "The patient's upcoming appointments and those of the past year" })
  async appointments(@CurrentPatient() patient: PortalPrincipal) {
    const result = await this.clinic.patientAppointments(patient.organizationId, patient.patientId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.appointments-view",
      resourceType: "appointment",
      patientId: patient.patientId,
    });
    return result;
  }

  @Get("results")
  @ApiOperation({ summary: "Released laboratory results the laboratory allows patients to see (critical values after the care team acknowledged them)" })
  async results(@CurrentPatient() patient: PortalPrincipal) {
    const results = await this.lab.results(patient.organizationId, patient.patientId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.results-view",
      resourceType: "lab_result",
      patientId: patient.patientId,
      metadata: { results: results.length },
    });
    return results;
  }

  @Get("results/orders/:orderId/report.pdf")
  @ApiOperation({ summary: "The patient's printable report of one laboratory order (only results the patient may see)" })
  async labReport(@CurrentPatient() patient: PortalPrincipal, @Param("orderId", ParseUUIDPipe) orderId: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.labReports.patientReport(patient.organizationId, patient.patientId, orderId, patientAuditContext(patient));
    return pdfFile(pdf, filename);
  }

  @Get("results/trend")
  @ApiOperation({ summary: "The patient's visible results of one test over time" })
  async trend(@CurrentPatient() patient: PortalPrincipal, @Query("testId", new ParseUUIDPipe()) testId: string) {
    const trend = await this.lab.trend(patient.organizationId, patient.patientId, testId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.results-trend",
      resourceType: "lab_test",
      resourceId: testId,
      patientId: patient.patientId,
    });
    return trend;
  }

  @Get("prescriptions")
  @ApiOperation({ summary: "The patient's active prescriptions" })
  async activePrescriptions(@CurrentPatient() patient: PortalPrincipal) {
    const rows = await this.prescriptions.activeForPatient(patient.organizationId, patient.patientId);
    const prescribers = await this.clinic.practitionerNames(patient.organizationId, [...new Set(rows.map((r) => r.prescriberPractitionerId))]);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.prescriptions-view",
      resourceType: "prescription",
      patientId: patient.patientId,
    });
    return rows.map((rx) => ({
      id: rx.id,
      prescriptionNumber: rx.prescriptionNumber,
      issuedAt: rx.issuedAt,
      prescriberName: prescribers.get(rx.prescriberPractitionerId) ?? null,
      notes: rx.notes,
      items: rx.items.map((i) => ({
        genericName: i.genericName,
        brandName: i.brandName,
        strength: i.strength,
        dosageForm: i.dosageForm,
        doseAmount: i.doseAmount,
        doseUnit: i.doseUnit,
        route: i.route,
        frequency: i.frequency,
        frequencyText: i.frequencyText,
        asNeededReason: i.asNeededReason,
        durationValue: i.durationValue,
        durationUnit: i.durationUnit,
        quantity: i.quantity,
        quantityUnit: i.quantityUnit,
        refills: i.refills,
        instructions: i.instructions,
      })),
    }));
  }

  @Get("care-plans")
  @ApiOperation({ summary: "The patient's active care plans: goals and what is next" })
  async carePlan(@CurrentPatient() patient: PortalPrincipal) {
    const plans = await this.carePlans.patientView(patient.organizationId, patient.patientId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.care-plans-view",
      resourceType: "care_plan",
      patientId: patient.patientId,
    });
    return plans;
  }
}
