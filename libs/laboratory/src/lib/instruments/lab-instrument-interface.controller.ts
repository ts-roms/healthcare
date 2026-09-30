import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import {
  DismissInstrumentResultDto,
  InstrumentInterfaceDto,
  InstrumentMessageDto,
  InstrumentResultQueryDto,
  InstrumentTestCodeDto,
} from "./instrument-interface.dto";
import { LabInstrumentInterfaceService } from "./lab-instrument-interface.service";

const uuid = new ParseUUIDPipe();

/** Analyzer interfaces: settings, messages from the instrument gateway, and the review of the results they carry. */
@ApiTags("laboratory")
@ApiBearerAuth()
@Controller({ path: "laboratory", version: "1" })
export class LabInstrumentInterfaceController {
  constructor(private readonly interfaces: LabInstrumentInterfaceService) {}

  @Get("instruments/:id/interface")
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "The instrument's interface settings (protocol, specimen id field) and analyzer test codes" })
  settings(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.interfaces.settings(actor, id);
  }

  @Put("instruments/:id/interface")
  @RequirePermissions("lab.qc.manage")
  @ApiOperation({ summary: "Set the instrument's protocol (HL7 v2 or ASTM), where it sends the specimen id, and whether messages are accepted" })
  configure(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: InstrumentInterfaceDto) {
    return this.interfaces.configure(actor, id, body);
  }

  @Put("instruments/:id/interface/test-codes")
  @RequirePermissions("lab.qc.manage")
  @ApiOperation({ summary: "Map an analyzer test code to a catalog test (or remove the mapping with testId null)" })
  setTestCode(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: InstrumentTestCodeDto) {
    return this.interfaces.setTestCode(actor, id, body);
  }

  @Post("instruments/:id/messages")
  @HttpCode(200)
  @RequirePermissions("lab.instrument.message.submit")
  @ApiOperation({ summary: "Receive one result message (HL7 v2 ORU^R01 or ASTM E1394) from the instrument gateway; results wait for review" })
  receive(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: InstrumentMessageDto) {
    return this.interfaces.receive(actor, id, body.message);
  }

  @Get("instrument-results")
  @RequireFacility()
  @RequirePermissions("lab.result.read")
  @ApiOperation({ summary: "Results received from instruments at the selected facility: waiting for review (oldest first) or recently decided" })
  list(@CurrentActor() actor: Actor, @Query() query: InstrumentResultQueryDto) {
    return this.interfaces.list(actor, query.state, query.instrumentId);
  }

  @Post("instrument-results/:id/accept")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.result.enter")
  @ApiOperation({ summary: "Enter a matched instrument result as the test's result (then verified and approved as usual)" })
  accept(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.interfaces.accept(actor, id);
  }

  @Post("instrument-results/:id/dismiss")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.result.enter")
  @ApiOperation({ summary: "Set an instrument result aside with a reason (e.g. a repeat, or entered by hand)" })
  dismiss(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: DismissInstrumentResultDto) {
    return this.interfaces.dismiss(actor, id, body.reason);
  }
}
