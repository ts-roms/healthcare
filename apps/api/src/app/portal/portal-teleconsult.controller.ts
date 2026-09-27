import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";
import { type PatientContext, TelemedicineService } from "@healthcare/telemedicine";

const context = (p: PortalPrincipal): PatientContext => ({ organizationId: p.organizationId, patientId: p.patientId, audit: patientAuditContext(p) });

/** The patient's side of online consultations: questionnaire, waiting room, video. */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/teleconsults", version: "1" })
export class PortalTeleconsultController {
  constructor(private readonly telemedicine: TelemedicineService) {}

  @Get()
  @ApiOperation({ summary: "The patient's online consultations (from yesterday on)" })
  list(@CurrentPatient() patient: PortalPrincipal) {
    return this.telemedicine.patientConsultations(context(patient));
  }

  @Get(":appointmentId")
  get(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string) {
    return this.telemedicine.patientConsultation(context(patient), appointmentId);
  }

  @Put(":appointmentId/questionnaire")
  @ApiOperation({ summary: "Answer the pre-consult questionnaire (includes the online-consultation acknowledgement)" })
  questionnaire(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string, @Body() body: unknown) {
    return this.telemedicine.submitQuestionnaire(context(patient), appointmentId, body);
  }

  @Post(":appointmentId/waiting-room")
  @HttpCode(200)
  @ApiOperation({ summary: "Enter the waiting room (from 30 minutes before the start); checks the visit in" })
  waitingRoom(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string) {
    return this.telemedicine.enterWaitingRoom(context(patient), appointmentId);
  }

  @Post(":appointmentId/video")
  @HttpCode(200)
  @ApiOperation({ summary: "A short-lived video token, once the clinician has started the consultation" })
  video(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string) {
    return this.telemedicine.patientVideo(context(patient), appointmentId);
  }
}
