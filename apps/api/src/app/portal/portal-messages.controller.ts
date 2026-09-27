import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { Public } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { CurrentPatient, PatientAccessGuard, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * The patient's MyHealth inbox: in-app messages from the clinic (results-ready
 * notices, booking confirmations, follow-up reminders, messages written by
 * staff). One-way for now: patients reply by calling or visiting the clinic.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/messages", version: "1" })
export class PortalMessagesController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: "The patient's messages, newest first" })
  async list(@CurrentPatient() patient: PortalPrincipal) {
    const messages = await this.notifications.patientInbox(patient.organizationId, patient.patientId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.messages-view",
      resourceType: "notification",
      patientId: patient.patientId,
      metadata: { count: messages.length },
    });
    return messages;
  }

  @Get("unread-count")
  @ApiOperation({ summary: "How many messages are unread (for the navigation badge)" })
  async unread(@CurrentPatient() patient: PortalPrincipal) {
    return { unread: await this.notifications.patientUnreadCount(patient.organizationId, patient.patientId) };
  }

  @Post(":messageId/read")
  @HttpCode(204)
  async read(@CurrentPatient() patient: PortalPrincipal, @Param("messageId", ParseUUIDPipe) messageId: string): Promise<void> {
    await this.notifications.markReadForPatient(patient.organizationId, patient.patientId, messageId);
  }
}
