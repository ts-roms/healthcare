import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { DayDto, EndDto, EscalateDto, InstructionsDto } from "./telemedicine.dto";
import { TelemedicineService } from "./telemedicine.service";

/** Staff side of online consultations, for the selected facility. */
@ApiTags("telemedicine")
@ApiBearerAuth()
@RequireFacility()
@Controller({ path: "telemedicine/consultations", version: "1" })
export class TelemedicineController {
  constructor(private readonly telemedicine: TelemedicineService) {}

  @Get()
  @RequirePermissions("telemedicine.read")
  @ApiOperation({ summary: "Online consultations for a day (default today): who has answered the questionnaire, who is waiting" })
  day(@CurrentActor() actor: Actor, @Query() query: DayDto) {
    return this.telemedicine.day(actor, query.date);
  }

  @Get(":appointmentId")
  @RequirePermissions("telemedicine.read")
  @ApiOperation({ summary: "One online consultation with the pre-consult questionnaire (audited)" })
  get(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) appointmentId: string) {
    return this.telemedicine.get(actor, appointmentId);
  }

  @Post(":appointmentId/start")
  @HttpCode(200)
  @RequirePermissions("telemedicine.conduct", "encounter.write")
  @ApiOperation({ summary: "Start the consultation for a waiting patient: opens the telemedicine encounter and returns a video token" })
  start(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) appointmentId: string) {
    return this.telemedicine.start(actor, appointmentId);
  }

  @Post(":appointmentId/join")
  @HttpCode(200)
  @RequirePermissions("telemedicine.conduct")
  join(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) appointmentId: string) {
    return this.telemedicine.join(actor, appointmentId);
  }

  @Post(":appointmentId/end")
  @HttpCode(200)
  @RequirePermissions("telemedicine.conduct")
  @ApiOperation({ summary: "End the call; the encounter stays open for documentation and signing" })
  end(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) appointmentId: string, @Body() body: EndDto) {
    return this.telemedicine.end(actor, appointmentId, body.patientInstructions);
  }

  @Post(":appointmentId/escalate")
  @HttpCode(200)
  @RequirePermissions("telemedicine.conduct")
  @ApiOperation({ summary: "Escalate to in-person care (reason required); book the in-person visit as usual" })
  escalate(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) appointmentId: string, @Body() body: EscalateDto) {
    return this.telemedicine.escalate(actor, appointmentId, body.reason, body.patientInstructions);
  }

  @Put(":appointmentId/instructions")
  @RequirePermissions("telemedicine.conduct")
  @ApiOperation({ summary: "What the patient should do next (shown in MyHealth)" })
  instructions(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) appointmentId: string, @Body() body: InstructionsDto) {
    return this.telemedicine.setInstructions(actor, appointmentId, body.patientInstructions);
  }
}
