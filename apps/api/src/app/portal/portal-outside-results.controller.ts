import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SubmitOutsideResultDto, SubmissionUploadDto, OutsideResultSubmissionService } from "@healthcare/clinic";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * Results from another laboratory or hospital that the patient sends to the clinic from MyHealth: they upload the
 * report and say what it is; the records office files it on their record or declines it with a reason they read here.
 * Nothing sent is part of their record until it is filed. Only the account holder themself (a guardian acting for
 * someone cannot send on their behalf). Public to the staff guard; the patient guard re-checks the session, account
 * and portal consent; audited with actor type "patient".
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/outside-results", version: "1" })
export class PortalOutsideResultsController {
  constructor(private readonly submissions: OutsideResultSubmissionService) {}

  @Get()
  @ApiOperation({ summary: "The results the patient sent, newest first, with where each stands and the reason when declined" })
  list(@CurrentPatient() patient: PortalPrincipal) {
    return this.submissions.forPatient(patientAuditContext(patient));
  }

  @Post("uploads")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Prepare an upload of the report (image or PDF, 10 MB, 10 a day); returns a signed upload URL" })
  startUpload(@CurrentPatient() patient: PortalPrincipal, @Body() body: SubmissionUploadDto) {
    return this.submissions.startUpload(patientAuditContext(patient), body);
  }

  @Post("uploads/:documentId/complete")
  @HttpCode(200)
  @ApiOperation({ summary: "Confirm the report is in place so it can be sent" })
  completeUpload(@CurrentPatient() patient: PortalPrincipal, @Param("documentId", ParseUUIDPipe) documentId: string) {
    return this.submissions.completeUpload(patientAuditContext(patient), documentId);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Send an uploaded report to the records office (three waiting at most)" })
  submit(@CurrentPatient() patient: PortalPrincipal, @Body() body: SubmitOutsideResultDto) {
    return this.submissions.submit(patientAuditContext(patient), body);
  }

  @Post(":submissionId/withdraw")
  @HttpCode(200)
  @ApiOperation({ summary: "Take back a result the records office has not answered yet" })
  withdraw(@CurrentPatient() patient: PortalPrincipal, @Param("submissionId", ParseUUIDPipe) id: string) {
    return this.submissions.withdraw(patientAuditContext(patient), id);
  }

  @Get(":submissionId/link")
  @ApiOperation({ summary: "A short-lived link to the report the patient sent (audited)" })
  link(@CurrentPatient() patient: PortalPrincipal, @Param("submissionId", ParseUUIDPipe) id: string) {
    return this.submissions.linkForPatient(patientAuditContext(patient), id);
  }
}
