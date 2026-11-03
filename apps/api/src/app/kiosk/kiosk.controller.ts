import { Body, Controller, Delete, Get, HttpCode, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { Headers } from "@nestjs/common";
import { KioskCheckInService } from "./kiosk-checkin.service";
import { KioskDeviceService } from "./kiosk-device.service";
import { KioskRegistrationService } from "./kiosk-registration.service";
import { KioskSessionService } from "./kiosk-session.service";
import { HeartbeatDto, IdentifyDto, KioskCheckInDto, KioskRegistrationDto } from "./kiosk.dto";

const SESSION_HEADER = "x-kiosk-session";
const sessionHeader = () => ApiHeader({ name: "X-Kiosk-Session", description: "The token returned when the session was opened" });

// Many kiosks can share one network address, so these limits are generous per address; the real guards are the
// per-session identification limit and the per-kiosk registration backlog.
const SESSION_THROTTLE = { default: { limit: 60, ttl: 60_000 } };
const IDENTIFY_THROTTLE = { default: { limit: 40, ttl: 60_000 } };

/**
 * The patient self-service kiosk's own API (docs/domains/kiosk.md). The kiosk signs in as a staff account holding only
 * the Patient kiosk role (`kiosk.session.use`), which grants none of the patient record permissions; everything a
 * patient can do here goes through a session that this controller never lets the screen widen.
 */
@ApiTags("kiosk")
@ApiBearerAuth()
@Controller({ path: "kiosk", version: "1" })
@RequireFacility()
@RequirePermissions("kiosk.session.use")
export class KioskController {
  constructor(
    private readonly devices: KioskDeviceService,
    private readonly sessions: KioskSessionService,
    private readonly checkIn: KioskCheckInService,
    private readonly registrations: KioskRegistrationService,
  ) {}

  @Get("me")
  @ApiOperation({ summary: "This kiosk and its facility (no patient data)" })
  me(@CurrentActor() actor: Actor) {
    return this.devices.me(actor);
  }

  @Post("heartbeat")
  @HttpCode(200)
  @ApiOperation({ summary: "Report that the kiosk is running, with its app version and printer status" })
  heartbeat(@CurrentActor() actor: Actor, @Body() body: HeartbeatDto) {
    return this.devices.heartbeat(actor, body);
  }

  @Get("services")
  @ApiOperation({ summary: "The walk-in services this kiosk offers" })
  async services(@CurrentActor() actor: Actor) {
    return { items: await this.checkIn.services(actor) };
  }

  @Post("sessions")
  @Throttle(SESSION_THROTTLE)
  @ApiOperation({ summary: "Start a session for the person at the kiosk; ends any session this kiosk still has open" })
  open(@CurrentActor() actor: Actor) {
    return this.sessions.open(actor);
  }

  @Delete("sessions")
  @HttpCode(204)
  @sessionHeader()
  @ApiOperation({ summary: "End the session" })
  async end(@CurrentActor() actor: Actor, @Headers(SESSION_HEADER) token: string | undefined) {
    await this.sessions.end(actor, token);
  }

  @Post("identify")
  @HttpCode(200)
  @Throttle(IDENTIFY_THROTTLE)
  @sessionHeader()
  @ApiOperation({ summary: "Recognise an existing patient (number, birth date and given name); three misses lock the session" })
  identify(@CurrentActor() actor: Actor, @Headers(SESSION_HEADER) token: string | undefined, @Body() body: IdentifyDto) {
    return this.sessions.identify(actor, token, body);
  }

  @Get("appointments")
  @sessionHeader()
  @ApiOperation({ summary: "Today's appointments of the identified patient, with whether check-in is open" })
  appointments(@CurrentActor() actor: Actor, @Headers(SESSION_HEADER) token: string | undefined) {
    return this.checkIn.appointments(actor, token);
  }

  @Post("check-in")
  @sessionHeader()
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "Makes retries of this request safe" })
  @ApiOperation({ summary: "Check in for an appointment or as a walk-in and receive the queue ticket" })
  checkInPatient(@CurrentActor() actor: Actor, @Headers(SESSION_HEADER) token: string | undefined, @Body() body: KioskCheckInDto) {
    return this.checkIn.checkIn(actor, token, body);
  }

  @Post("registrations")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @sessionHeader()
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "Makes retries of this request safe" })
  @ApiOperation({ summary: "Submit a new patient's registration for staff review; answers only a reference" })
  register(@CurrentActor() actor: Actor, @Headers(SESSION_HEADER) token: string | undefined, @Body() body: KioskRegistrationDto) {
    return this.registrations.submit(actor, token, body);
  }
}
