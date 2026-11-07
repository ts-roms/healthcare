import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { DeviceRateLimitGuard } from "../rate-limit.guard";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { KioskDeviceService } from "./kiosk-device.service";
import { KioskPrintService } from "./kiosk-print.service";
import { ClaimPrintDto, PrinterHeartbeatDto, PrintResultDto } from "./kiosk.dto";

// The agent asks for each of its kiosks' tickets every couple of seconds, and a busy round claims several in a row: with five
// kiosks that is already more than 120 requests a minute, and going over blocks the account for the whole minute, so tickets
// would wait. The account holds one permission and opens no patient data, so a high ceiling costs nothing.
const AGENT_THROTTLE = { default: { limit: 600, ttl: 60_000 } };

/**
 * The local print agent's API (docs/domains/kiosk.md, "Printing and devices"). The agent signs in as its own account
 * holding only `kiosk.print.agent`, which opens no patient data: a job carries what is printed on a ticket and nothing more.
 * The agent only pulls; nothing here reaches back into the clinic's network.
 */
@ApiTags("kiosk printing")
@ApiBearerAuth()
@Controller({ path: "kiosk/print", version: "1" })
@UseGuards(DeviceRateLimitGuard)
@RequireFacility()
@RequirePermissions("kiosk.print.agent")
export class KioskPrintController {
  constructor(
    private readonly print: KioskPrintService,
    private readonly devices: KioskDeviceService,
  ) {}

  @Get("config")
  @Throttle(AGENT_THROTTLE)
  @ApiOperation({
    summary: "What the print agent needs: its facility's time zone and, for each kiosk it may serve, whether it prints and where its printer is",
  })
  config(@CurrentActor() actor: Actor) {
    return this.devices.printConfig(actor);
  }

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
@UseGuards(DeviceRateLimitGuard)
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
