import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { type Actor, CurrentActor, Public, RequirePermissions } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, ProxyAllowed } from "../portal/patient-access.guard";
import type { PortalPrincipal } from "../portal/portal-account.service";
import {
  AssignThreadDto,
  NoteDto,
  PatientUploadDto,
  ReplyDto,
  SettingsQueryDto,
  StaffStartThreadDto,
  StartThreadDto,
  ThreadQueryDto,
  UpsertSettingDto,
} from "./patient-message.dto";
import { PatientMessageService } from "./patient-message.service";

/** The patient's conversations with the clinic in MyHealth. Public to the staff guard; the patient guard protects every request. */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal/message-threads", version: "1" })
export class PortalMessageThreadsController {
  constructor(private readonly messages: PatientMessageService) {}

  @Get()
  @ApiOperation({ summary: "The patient's conversations, newest first" })
  list(@CurrentPatient() patient: PortalPrincipal) {
    return this.messages.listForPatient(patient);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Conversations with a clinic message not yet read" })
  async unread(@CurrentPatient() patient: PortalPrincipal) {
    return { unread: await this.messages.unreadCountForPatient(patient) };
  }

  @Post("uploads")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Prepare an upload (image or PDF, 10 MB, 10 a day) to attach to a message; returns a signed upload URL" })
  startUpload(@CurrentPatient() patient: PortalPrincipal, @Body() body: PatientUploadDto) {
    return this.messages.startPatientUpload(patient, body);
  }

  @Post("uploads/:documentId/complete")
  @HttpCode(200)
  @ApiOperation({ summary: "Confirm an upload is in place so it can be attached" })
  completeUpload(@CurrentPatient() patient: PortalPrincipal, @Param("documentId", ParseUUIDPipe) documentId: string) {
    return this.messages.completePatientUpload(patient, documentId);
  }

  @Get(":threadId/attachments/:documentId/link")
  @ApiOperation({ summary: "A short-lived link to an attachment of the conversation (audited)" })
  attachmentLink(
    @CurrentPatient() patient: PortalPrincipal,
    @Param("threadId", ParseUUIDPipe) threadId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ) {
    return this.messages.attachmentLinkForPatient(patient, threadId, documentId);
  }

  @Get(":threadId")
  @ApiOperation({ summary: "One conversation with its messages; opening it marks the clinic's messages read" })
  open(@CurrentPatient() patient: PortalPrincipal, @Param("threadId", ParseUUIDPipe) threadId: string) {
    return this.messages.openForPatient(patient, threadId);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Start a conversation with the clinic (not for emergencies; 5 open at a time, 10 messages an hour)" })
  start(@CurrentPatient() patient: PortalPrincipal, @Body() body: StartThreadDto) {
    return this.messages.startForPatient(patient, body);
  }

  @Post(":threadId/messages")
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Write in an open conversation" })
  reply(@CurrentPatient() patient: PortalPrincipal, @Param("threadId", ParseUUIDPipe) threadId: string, @Body() body: ReplyDto) {
    return this.messages.replyForPatient(patient, threadId, body.body, body.documentIds);
  }
}

/** The clinic's side of MyHealth conversations (`patient.message.read` to read, `patient.message.manage` to write). */
@ApiTags("patient messages")
@ApiBearerAuth()
@Controller({ path: "patient-messages", version: "1" })
export class PatientMessagesController {
  constructor(private readonly messages: PatientMessageService) {}

  @Get()
  @RequirePermissions("patient.message.read")
  @ApiOperation({ summary: "Conversations: waiting for the clinic (longest wait first), open, closed or all" })
  list(@CurrentActor() actor: Actor, @Query() query: ThreadQueryDto) {
    return this.messages.listForStaff(actor, {
      filter: query.filter,
      facilityId: query.facilityId,
      patientId: query.patientId,
      assignedToMe: query.assignedToMe === "true",
    });
  }

  @Get("awaiting-count")
  @RequirePermissions("patient.message.read")
  async awaiting(@CurrentActor() actor: Actor) {
    return { awaiting: await this.messages.awaitingCount(actor) };
  }

  @Get("overdue-count")
  @RequirePermissions("patient.message.read")
  @ApiOperation({ summary: "Conversations past their response target" })
  async overdue(@CurrentActor() actor: Actor) {
    return { overdue: await this.messages.overdueCount(actor) };
  }

  @Get("settings")
  @RequirePermissions("patient.message.read")
  @ApiOperation({ summary: "Routing and response targets per topic at a facility" })
  settings(@CurrentActor() actor: Actor, @Query() query: SettingsQueryDto) {
    return this.messages.listSettings(actor, query.facilityId);
  }

  @Put("settings")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Set where a topic's conversations go and how soon the clinic means to answer (audited, versioned)" })
  upsertSetting(@CurrentActor() actor: Actor, @Body() body: UpsertSettingDto) {
    return this.messages.upsertSetting(actor, body);
  }

  @Get(":threadId/attachments/:documentId/link")
  @RequirePermissions("patient.message.read", "document.read")
  @ApiOperation({ summary: "A short-lived link to an attachment of the conversation (audited)" })
  attachmentLink(@CurrentActor() actor: Actor, @Param("threadId", ParseUUIDPipe) threadId: string, @Param("documentId", ParseUUIDPipe) documentId: string) {
    return this.messages.attachmentLinkForStaff(actor, threadId, documentId);
  }

  @Get(":threadId")
  @RequirePermissions("patient.message.read")
  @ApiOperation({ summary: "One conversation with its messages (audited)" })
  get(@CurrentActor() actor: Actor, @Param("threadId", ParseUUIDPipe) threadId: string) {
    return this.messages.getForStaff(actor, threadId);
  }

  @Post()
  @RequirePermissions("patient.message.manage")
  @ApiOperation({ summary: "Start a conversation with a patient who uses MyHealth" })
  start(@CurrentActor() actor: Actor, @Body() body: StaffStartThreadDto) {
    return this.messages.startForStaff(actor, body);
  }

  @Post(":threadId/messages")
  @HttpCode(201)
  @RequirePermissions("patient.message.manage")
  @ApiOperation({ summary: "Reply; the patient is told by SMS or email that a message is waiting (never its content)" })
  reply(@CurrentActor() actor: Actor, @Param("threadId", ParseUUIDPipe) threadId: string, @Body() body: ReplyDto) {
    return this.messages.replyForStaff(actor, threadId, body.body, body.documentIds);
  }

  @Post(":threadId/notes")
  @HttpCode(201)
  @RequirePermissions("patient.message.manage")
  @ApiOperation({ summary: "Add an internal note the patient never sees" })
  note(@CurrentActor() actor: Actor, @Param("threadId", ParseUUIDPipe) threadId: string, @Body() body: NoteDto) {
    return this.messages.addNote(actor, threadId, body.body);
  }

  @Post(":threadId/assignment")
  @HttpCode(200)
  @RequirePermissions("patient.message.manage")
  assign(@CurrentActor() actor: Actor, @Param("threadId", ParseUUIDPipe) threadId: string, @Body() body: AssignThreadDto) {
    return this.messages.assign(actor, threadId, body.assignToMe);
  }

  @Post(":threadId/close")
  @HttpCode(200)
  @RequirePermissions("patient.message.manage")
  close(@CurrentActor() actor: Actor, @Param("threadId", ParseUUIDPipe) threadId: string) {
    return this.messages.setStatus(actor, threadId, "closed");
  }

  @Post(":threadId/reopen")
  @HttpCode(200)
  @RequirePermissions("patient.message.manage")
  reopen(@CurrentActor() actor: Actor, @Param("threadId", ParseUUIDPipe) threadId: string) {
    return this.messages.setStatus(actor, threadId, "open");
  }
}
