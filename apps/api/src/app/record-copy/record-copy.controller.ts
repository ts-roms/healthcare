import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { PrepareRecordCopyDto } from "@healthcare/patient";
import { RecordCopyService } from "./record-copy.service";

/** Copies of the record prepared by the records office for a patient's records request. */
@ApiTags("records requests")
@ApiBearerAuth()
@Controller({ path: "records-requests", version: "1" })
export class RecordCopyController {
  constructor(private readonly copies: RecordCopyService) {}

  @Post(":requestId/copies")
  @RequirePermissions("patient.records-request.manage")
  @ApiOperation({
    summary: "Compile the chosen sections of the patient's record over a period into one PDF, stored as a record_copy document to share in answer",
  })
  prepare(@CurrentActor() actor: Actor, @Param("requestId", ParseUUIDPipe) id: string, @Body() body: PrepareRecordCopyDto) {
    return this.copies.prepare(actor, id, body);
  }
}
