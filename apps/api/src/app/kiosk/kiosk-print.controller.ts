import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { KioskDeviceService } from "./kiosk-device.service";
import { KioskPrintService } from "./kiosk-print.service";
import { ClaimPrintDto, PrinterHeartbeatDto, PrintResultDto } from "./kiosk.dto";

// The agent polls every few seconds and reports regularly: generous per address, since one agent serves a facility.
const AGENT_THROTTLE = { default: { limit: 120, ttl: 60_000 } };

/**
 * The local print agent's API (docs/domains/kiosk.md, "Printing and devices"). The agent signs in as its own account
 * holding only `kiosk.print.agent`, which opens no patient data: a job carries what is printed on a ticket and nothing more.
 * The agent only pulls; nothing here reaches back into the clinic's network.
 */
@ApiTags("kiosk printing")
@ApiBearerAuth()
@Controller({ path: "kiosk/print", version: "1" })
@RequireFacility()
@RequirePermissions("kiosk.print.agent")
export class KioskPrintController {
  constructor(private readonly print: KioskPrintService) {}

  @Post("claim")
  @HttpCode(200)
  @Throttle(AGENT_THROTTLE)
  @ApiOperation({ summary: "Claim the next ticket to print for one kiosk, held under a 30-second lease; the job is null when nothing waits" })
  async claim(@CurrentActor() actor: Actor, @Body() body: ClaimPrintDto) {
    return { job: await this.print.claim(actor, body) };
  }

  @Post("jobs/:jobId/result")
  @HttpCode(200)
  @Throttle(AGENT_THROTTLE)
  @ApiOperation({ summary: "Report that a claimed ticket was printed or failed (and whether the agent will retry)" })
  result(@CurrentActor() actor: Actor, @Param("jobId", ParseUUIDPipe) jobId: string, @Body() body: PrintResultDto) {
    return this.print.report(actor, jobId, body);
  }

  @Post("heartbeat")
  @HttpCode(200)
  @Throttle(AGENT_THROTTLE)
  @ApiOperation({ summary: "Report the state of the printer the agent drives for one kiosk" })
  heartbeat(@CurrentActor() actor: Actor, @Body() body: PrinterHeartbeatDto) {
    return this.print.printerHeartbeat(actor, body);
  }
}

/** A waiting-room display reporting that it is showing, so staff can see which screens are alive. */
@ApiTags("kiosk devices")
@ApiBearerAuth()
@Controller({ path: "kiosk/display", version: "1" })
@RequireFacility()
@RequirePermissions("clinic.queue.display")
export class KioskDisplayController {
  constructor(private readonly devices: KioskDeviceService) {}

  @Post("heartbeat")
  @HttpCode(200)
  @ApiOperation({ summary: "A registered waiting-room display reports that it is running (an unregistered one is simply not monitored)" })
  heartbeat(@CurrentActor() actor: Actor) {
    return this.devices.displayHeartbeat(actor);
  }
}
