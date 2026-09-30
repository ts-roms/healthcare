import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  PatientBookDto,
  type PatientBookingContext,
  PatientBookingService,
  PatientCancelDto,
  PatientRescheduleDto,
  PatientSlotsDto,
  PatientWaitlistJoinDto,
  PatientWaitlistService,
} from "@healthcare/clinic";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, ProxyAllowed, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

const context = (p: PortalPrincipal): PatientBookingContext => ({ organizationId: p.organizationId, patientId: p.patientId, audit: patientAuditContext(p) });

/**
 * Patients booking, moving and cancelling their own appointments (MyHealth).
 * The clinic decides which visit types are bookable online; the rules (notice,
 * horizon, open-booking limit, change cut-off, waiting list) are set per facility and enforced by the clinic domain.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal", version: "1" })
export class PortalBookingController {
  constructor(
    private readonly booking: PatientBookingService,
    private readonly waitlist: PatientWaitlistService,
  ) {}

  @Get("booking/options")
  @ApiOperation({ summary: "Facilities, practitioners and visit types open for online booking, with the booking rules" })
  options(@CurrentPatient() patient: PortalPrincipal) {
    return this.booking.options(patient.organizationId);
  }

  @Get("booking/slots")
  @ApiOperation({ summary: "Open times on one day (one practitioner, or everyone on duty at the facility)" })
  slots(@CurrentPatient() patient: PortalPrincipal, @Query() query: PatientSlotsDto) {
    return this.booking.slots(patient.organizationId, query);
  }

  @Get("booking/waitlist")
  @ApiOperation({ summary: "The patient's waiting-list requests for full days" })
  waitlistEntries(@CurrentPatient() patient: PortalPrincipal) {
    return this.waitlist.list(context(patient));
  }

  @Post("booking/waitlist")
  @ApiOperation({ summary: "Ask to be told when a time opens on days with no open times (where the clinic allows it); nothing is booked" })
  joinWaitlist(@CurrentPatient() patient: PortalPrincipal, @Body() body: PatientWaitlistJoinDto) {
    return this.waitlist.join(context(patient), body);
  }

  @Post("booking/waitlist/:entryId/leave")
  @HttpCode(204)
  @ApiOperation({ summary: "Take a waiting-list request back" })
  async leaveWaitlist(@CurrentPatient() patient: PortalPrincipal, @Param("entryId", ParseUUIDPipe) entryId: string): Promise<void> {
    await this.waitlist.leave(context(patient), entryId);
  }

  @Post("appointments")
  @ApiOperation({ summary: "Book an appointment" })
  book(@CurrentPatient() patient: PortalPrincipal, @Body() body: PatientBookDto) {
    return this.booking.book(context(patient), body);
  }

  @Post("appointments/:appointmentId/reschedule")
  @HttpCode(200)
  @ApiOperation({
    summary: "Move an appointment to another open time, with the same or another practitioner at the same facility (until the clinic's cut-off)",
  })
  reschedule(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string, @Body() body: PatientRescheduleDto) {
    return this.booking.reschedule(context(patient), appointmentId, body);
  }

  @Post("appointments/:appointmentId/cancel")
  @HttpCode(200)
  @ApiOperation({ summary: "Cancel an appointment (until 2 hours before)" })
  cancel(@CurrentPatient() patient: PortalPrincipal, @Param("appointmentId", ParseUUIDPipe) appointmentId: string, @Body() body: PatientCancelDto) {
    return this.booking.cancel(context(patient), appointmentId, body);
  }
}
