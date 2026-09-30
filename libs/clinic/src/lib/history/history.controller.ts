import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import {
  FamilyReviewDto,
  HistoryInErrorDto,
  RecordFamilyHistoryDto,
  RecordPastConditionDto,
  RecordPastProcedureDto,
  RecordSocialHistoryDto,
} from "./history.dto";
import { PatientHistoryService } from "./history.service";

/**
 * Patient history (docs/domains/patient-history.md): past procedures and conditions, family history with its review,
 * and social history versions. Organization-scoped; not tied to a facility. Substance use and sexual history also need
 * encounter.write (withheld otherwise).
 */
@ApiTags("patient-history")
@ApiBearerAuth()
@Controller({ version: "1" })
export class PatientHistoryController {
  constructor(private readonly history: PatientHistoryService) {}

  @Get("patients/:patientId/history")
  @RequirePermissions("history.read")
  @ApiOperation({ summary: "The patient's history, every section (records merged into it included; entries in error marked). One audited read." })
  read(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.history.history(actor, patientId);
  }

  @Post("patients/:patientId/history/procedures")
  @RequirePermissions("history.record")
  @ApiOperation({ summary: "Record a past procedure or surgery, as reported or documented here (not a procedure performed by the organization)" })
  procedure(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordPastProcedureDto) {
    return this.history.recordProcedure(actor, patientId, body);
  }

  @Post("patients/:patientId/history/conditions")
  @RequirePermissions("history.record")
  @ApiOperation({ summary: "Record a condition diagnosed elsewhere, as reported (never a diagnosis of the organization)" })
  condition(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordPastConditionDto) {
    return this.history.recordCondition(actor, patientId, body);
  }

  @Post("patients/:patientId/history/family")
  @RequirePermissions("history.record")
  @ApiOperation({ summary: "Record a relative's condition, as reported" })
  family(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordFamilyHistoryDto) {
    return this.history.recordFamily(actor, patientId, body);
  }

  @Post("patients/:patientId/history/family/review")
  @HttpCode(200)
  @RequirePermissions("history.record")
  @ApiOperation({ summary: "Record that the family history was asked about: complete as listed, none known, or not known (adopted, …)" })
  review(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: FamilyReviewDto) {
    return this.history.reviewFamily(actor, patientId, body);
  }

  @Post("patients/:patientId/history/social")
  @RequirePermissions("history.record")
  @ApiOperation({ summary: "Record a new version of the social history on top of the current one (basedOn); fields left out are carried over" })
  social(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordSocialHistoryDto) {
    return this.history.recordSocial(actor, patientId, body);
  }

  @Post("history/:entryId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("history.record")
  @ApiOperation({ summary: "Mark a history entry (procedure, condition, family history entry or social history version) entered in error" })
  enteredInError(@CurrentActor() actor: Actor, @Param("entryId", ParseUUIDPipe) entryId: string, @Body() body: HistoryInErrorDto) {
    return this.history.markEnteredInError(actor, entryId, body.reason);
  }
}
