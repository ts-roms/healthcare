import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import {
  AddIncidentEntryDto,
  AssessIncidentDto,
  CloseIncidentDto,
  PrivacyIncidentQueryDto,
  PrivacySettingDto,
  RecordNpcNotificationDto,
  RecordPrivacyIncidentDto,
  RecordSubjectsNotificationDto,
} from "./privacy.dto";
import { PrivacyIncidentService } from "./privacy-incident.service";

/** The personal data breach register and the organization's privacy settings (`privacy.incident.manage`). */
@ApiTags("privacy")
@ApiBearerAuth()
@Controller({ path: "privacy", version: "1" })
export class PrivacyController {
  constructor(private readonly incidents: PrivacyIncidentService) {}

  @Get("setting")
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "The organization's own breach-notification window and Data Protection Officer as named" })
  setting(@CurrentActor() actor: Actor) {
    return this.incidents.setting(actor.organizationId);
  }

  @Put("setting")
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "Set the organization's privacy settings (no NPC rule is encoded; audited)" })
  setSetting(@CurrentActor() actor: Actor, @Body() body: PrivacySettingDto) {
    return this.incidents.setSetting(actor, body);
  }

  @Get("incidents")
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "The breach register: open incidents (newest first), closed or all (audited)" })
  list(@CurrentActor() actor: Actor, @Query() query: PrivacyIncidentQueryDto) {
    return this.incidents.list(actor, query.status);
  }

  @Post("incidents")
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "Record a personal data breach or security incident (the notification window starts at discovery)" })
  record(@CurrentActor() actor: Actor, @Body() body: RecordPrivacyIncidentDto) {
    return this.incidents.record(actor, body);
  }

  @Get("incidents/:incidentId")
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "One incident with everything recorded about it, in order (audited)" })
  get(@CurrentActor() actor: Actor, @Param("incidentId", ParseUUIDPipe) id: string) {
    return this.incidents.get(actor, id);
  }

  @Post("incidents/:incidentId/entries")
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "Add a note or a containment step (append-only)" })
  addEntry(@CurrentActor() actor: Actor, @Param("incidentId", ParseUUIDPipe) id: string, @Body() body: AddIncidentEntryDto) {
    return this.incidents.addNote(actor, id, body);
  }

  @Post("incidents/:incidentId/assess")
  @HttpCode(200)
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "Record the assessment: notifiable or not, with the reason" })
  assess(@CurrentActor() actor: Actor, @Param("incidentId", ParseUUIDPipe) id: string, @Body() body: AssessIncidentDto) {
    return this.incidents.assess(actor, id, body);
  }

  @Post("incidents/:incidentId/npc-notification")
  @HttpCode(200)
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "Record that the National Privacy Commission was notified, with its reference" })
  npcNotified(@CurrentActor() actor: Actor, @Param("incidentId", ParseUUIDPipe) id: string, @Body() body: RecordNpcNotificationDto) {
    return this.incidents.recordNpcNotification(actor, id, body);
  }

  @Post("incidents/:incidentId/subjects-notification")
  @HttpCode(200)
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "Record that the affected people were told, and how" })
  subjectsNotified(@CurrentActor() actor: Actor, @Param("incidentId", ParseUUIDPipe) id: string, @Body() body: RecordSubjectsNotificationDto) {
    return this.incidents.recordSubjectsNotification(actor, id, body);
  }

  @Post("incidents/:incidentId/close")
  @HttpCode(200)
  @RequirePermissions("privacy.incident.manage")
  @ApiOperation({ summary: "Close an assessed incident with what was concluded" })
  close(@CurrentActor() actor: Actor, @Param("incidentId", ParseUUIDPipe) id: string, @Body() body: CloseIncidentDto) {
    return this.incidents.close(actor, id, body);
  }
}
