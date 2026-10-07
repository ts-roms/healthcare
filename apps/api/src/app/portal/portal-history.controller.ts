import { Body, Controller, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuditService } from "@healthcare/audit";
import { PatientHistoryPortalService, PatientHistoryService, PortalHistorySubmissionDto, StopReportedMedicationDto } from "@healthcare/clinic";
import { BusinessRuleError, Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, ProxyAllowed, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export class HistoryEntryParamsDto extends createZodDto(z.object({ id: z.uuid() })) {}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * The patient's health history in MyHealth: read as the clinic recorded it (no staff notes and not who recorded them;
 * entries in error left out; substance use and sexual history shown to the patient themself, never to someone acting
 * for them — `sensitiveWithheld`), a history questionnaire the patient answers in one go, and marking a medicine they
 * reported there as stopped. Answers become ordinary history entries reported by the patient (or a relative when a
 * guardian with "act" scope answers), labelled as recorded through MyHealth; nothing is reviewed into the record and
 * the clinic corrects a mistake the usual way. Public to the staff guard; the patient guard re-checks the session,
 * account and portal consent; a guardian may read with "view" and answer with "act" (`ProxyAllowed`). Audited with
 * actor type "patient".
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
    private readonly portalHistory: PatientHistoryPortalService,
    private readonly audit: AuditService,
  ) {}

  @Get("health-history")
  @ApiOperation({ summary: "The patient's health history as recorded by the clinic, with the questionnaires they completed" })
  async read(@CurrentPatient() patient: PortalPrincipal) {
    const sensitive = !patient.proxy;
    const view = await this.history.patientView(patient.organizationId, patient.patientId, { sensitive });
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.health-history-view",
      resourceType: "patient_history",
      patientId: patient.patientId,
      metadata: {
        sensitiveShown: sensitive,
        counts: {
          procedures: view.procedures.length,
          conditions: view.conditions.length,
          medications: view.medications.length,
          family: view.family.entries.length,
        },
      },
    });
    return view;
  }

  @Post("health-history/submissions")
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "A retry with the same key returns the first submission" })
  @ApiOperation({
    summary:
      "A history questionnaire answered in MyHealth: medicines taken, past illnesses, operations, family history and daily life, recorded as reported by the patient; at most 10 an hour",
  })
  async submit(@CurrentPatient() patient: PortalPrincipal, @Body() body: PortalHistorySubmissionDto, @Headers("idempotency-key") idempotencyKey?: string) {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new BusinessRuleError("Idempotency-Key must be 8-128 characters of [A-Za-z0-9._:-]", "invalid_idempotency_key");
    }
    return this.portalHistory.submit(this.writer(patient), body, idempotencyKey ?? null);
  }

  @Post("health-history/medications/:id/stopped")
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: "The patient no longer takes a medicine they reported in MyHealth (once; the clinic's own entries are changed at the clinic)" })
  stopMedication(@CurrentPatient() patient: PortalPrincipal, @Param() params: HistoryEntryParamsDto, @Body() body: StopReportedMedicationDto) {
    return this.portalHistory.stopMedication(this.writer(patient), params.id, body);
  }

  private writer(patient: PortalPrincipal) {
    return {
      organizationId: patient.organizationId,
      patientId: patient.patientId,
      portalAccountId: patient.accountId,
      proxyGrantId: patient.proxy?.grantId ?? null,
      audit: patientAuditContext(patient),
    };
  }
}
