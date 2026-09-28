import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ReferenceLabSubmissions } from "./reference-lab-submissions.service";

export const submitSendOutSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(100) });
export class SubmitSendOutDto extends createZodDto(submitSendOutSchema) {}

@ApiTags("integrations")
@ApiBearerAuth()
@Controller({ path: "integrations/reference-laboratories", version: "1" })
export class ReferenceLabIntegrationController {
  constructor(private readonly submissions: ReferenceLabSubmissions) {}

  @Get()
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "Status of the reference laboratory interface (an integration dependency until a laboratory's specification is obtained)" })
  integration() {
    return this.submissions.integration();
  }

  @Get("dispatches/:dispatchId/submissions")
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "Electronic submissions of a send-out dispatch, with readiness checks of the platform's data" })
  status(@CurrentActor() actor: Actor, @Param("dispatchId", ParseUUIDPipe) dispatchId: string) {
    return this.submissions.status(actor, dispatchId);
  }

  @Post("dispatches/:dispatchId/submissions")
  @HttpCode(202)
  @RequirePermissions("lab.specimen.receive")
  @ApiOperation({ summary: "Queue the dispatch for the integration worker (refused while the interface is an integration dependency)" })
  submit(@CurrentActor() actor: Actor, @Param("dispatchId", ParseUUIDPipe) dispatchId: string, @Body() body: SubmitSendOutDto) {
    return this.submissions.submit(actor, dispatchId, body.idempotencyKey);
  }
}
