import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, ProxyAllowed, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";
import { MessagesQueryDto, type PatientContext, SendMessageDto, TelemedicineChatService, TelemedicineService } from "@healthcare/telemedicine";

const context = (p: PortalPrincipal): PatientContext => ({ organizationId: p.organizationId, patientId: p.patientId, audit: patientAuditContext(p) });

/** The patient's side of online consultations: questionnaire, waiting room, video. */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal/teleconsults", version: "1" })
export class PortalTeleconsultController {
  constructor(
    private readonly telemedicine: TelemedicineService,
    private readonly chat: TelemedicineChatService,
  ) {}

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

  @Get(":appointmentId/messages")
  @ApiOperation({ summary: "The consultation's chat with the clinician (oldest first); `after` is the id of the last message already shown" })
  messages(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string, @Query() query: MessagesQueryDto) {
    return this.chat.patientMessages(context(patient), appointmentId, query.after);
  }

  @Post(":appointmentId/messages")
  @ApiOperation({ summary: "Send a chat message (from the waiting room until the call ends)" })
  sendMessage(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string, @Body() body: SendMessageDto) {
    return this.chat.patientSend(context(patient), appointmentId, body.body);
  }

  @Post(":appointmentId/payment")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Pay for the visit first (only when the clinic asks for payment before the waiting room): charges and invoices it once, returns the invoice to pay",
  })
  payment(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string) {
    return this.telemedicine.patientPayment(context(patient), appointmentId);
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
