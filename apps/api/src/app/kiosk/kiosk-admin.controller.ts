import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { DeviceRateLimitGuard } from "../rate-limit.guard";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { KioskDeviceService } from "./kiosk-device.service";
import { KioskPrintService } from "./kiosk-print.service";
import { KioskRegistrationService } from "./kiosk-registration.service";
import {
  ApproveRegistrationDto,
  LinkRegistrationDto,
  PrintJobsQueryDto,
  RegisterDeviceDto,
  RejectRegistrationDto,
  ReprintDto,
  UpdateDeviceDto,
} from "./kiosk.dto";

/** Staff side of the kiosk module: managing kiosks and reviewing what was typed at them. */
@ApiTags("kiosk administration")
@ApiBearerAuth()
@Controller({ path: "kiosk/admin", version: "1" })
@UseGuards(DeviceRateLimitGuard)
@RequireFacility()
export class KioskAdminController {
  constructor(
    private readonly devices: KioskDeviceService,
    private readonly registrations: KioskRegistrationService,
    private readonly print: KioskPrintService,
  ) {}

  @Get("devices")
  @RequirePermissions("kiosk.device.read")
  @ApiOperation({ summary: "The facility's kiosks with whether each is online, its app version and printer status" })
  async devicesList(@CurrentActor() actor: Actor) {
    return { items: await this.devices.list(actor) };
  }

  @Post("devices")
  @RequirePermissions("kiosk.device.manage")
  @ApiOperation({ summary: "Register a kiosk: a staff account with the Patient kiosk role, at this facility" })
  register(@CurrentActor() actor: Actor, @Body() body: RegisterDeviceDto) {
    return this.devices.register(actor, body);
  }

  @Patch("devices/:deviceId")
  @RequirePermissions("kiosk.device.manage")
  @ApiOperation({ summary: "Rename a kiosk, or put it into maintenance or out of service" })
  update(@CurrentActor() actor: Actor, @Param("deviceId", ParseUUIDPipe) deviceId: string, @Body() body: UpdateDeviceDto) {
    return this.devices.update(actor, deviceId, body);
  }

  @Get("print-jobs")
  @RequirePermissions("kiosk.device.read")
  @ApiOperation({ summary: "The facility's kiosk tickets of the last 24 hours: how each print went (no patient details)" })
  async printJobs(@CurrentActor() actor: Actor, @Query() query: PrintJobsQueryDto) {
    return { items: await this.print.list(actor, query.status) };
  }

  @Post("print-jobs/:jobId/reprint")
  @HttpCode(200)
  @RequirePermissions("kiosk.print.reprint")
  @ApiOperation({ summary: "Print a kiosk ticket again, with a reason (limited, audited)" })
  reprint(@CurrentActor() actor: Actor, @Param("jobId", ParseUUIDPipe) jobId: string, @Body() body: ReprintDto) {
    return this.print.reprint(actor, jobId, body);
  }

  @Get("registrations")
  @RequirePermissions("kiosk.registration.review")
  @ApiOperation({ summary: "Registrations waiting for review at this facility (no personal data)" })
  async pending(@CurrentActor() actor: Actor) {
    return { items: await this.registrations.pending(actor) };
  }

  @Get("registrations/:registrationId")
  @RequirePermissions("kiosk.registration.review")
  @ApiOperation({ summary: "What the person typed, with possible duplicates (audited)" })
  get(@CurrentActor() actor: Actor, @Param("registrationId", ParseUUIDPipe) id: string) {
    return this.registrations.get(actor, id);
  }

  @Post("registrations/:registrationId/approve")
  @HttpCode(200)
  @RequirePermissions("kiosk.registration.review", "patient.register")
  @ApiOperation({ summary: "Register the patient (ordinary duplicate rules) and optionally put them in the queue" })
  approve(@CurrentActor() actor: Actor, @Param("registrationId", ParseUUIDPipe) id: string, @Body() body: ApproveRegistrationDto) {
    return this.registrations.approve(actor, id, body);
  }

  @Post("registrations/:registrationId/link")
  @HttpCode(200)
  @RequirePermissions("kiosk.registration.review", "patient.read")
  @ApiOperation({ summary: "The person is an existing patient: close the submission against that record" })
  link(@CurrentActor() actor: Actor, @Param("registrationId", ParseUUIDPipe) id: string, @Body() body: LinkRegistrationDto) {
    return this.registrations.link(actor, id, body);
  }

  @Post("registrations/:registrationId/reject")
  @HttpCode(200)
  @RequirePermissions("kiosk.registration.review")
  @ApiOperation({ summary: "Reject the submission with a reason; what was typed is erased" })
  reject(@CurrentActor() actor: Actor, @Param("registrationId", ParseUUIDPipe) id: string, @Body() body: RejectRegistrationDto) {
    return this.registrations.reject(actor, id, body);
  }
}
