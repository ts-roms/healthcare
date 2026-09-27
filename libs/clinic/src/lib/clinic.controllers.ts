import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  AddDiagnosisDto,
  AmendNoteDto,
  AssignVisitDto,
  AvailabilityQueryDto,
  BookAppointmentDto,
  CallVisitDto,
  CancelAppointmentDto,
  CheckInDto,
  CloseWaitlistDto,
  CreateAllergyDto,
  CreateCodingSystemDto,
  CreateExceptionDto,
  CreatePractitionerDto,
  CreateRoomDto,
  CreateScheduleDto,
  CreateVisitTypeDto,
  UpdateVisitTypeDto,
  CreateWaitlistDto,
  DashboardQueryDto,
  EnteredInErrorDto,
  ListAppointmentsDto,
  ListEncountersDto,
  MoveVisitDto,
  QueueQueryDto,
  RecordVitalsDto,
  RescheduleDto,
  SaveNoteDto,
  SignEncounterDto,
  StartEncounterDto,
  TriageDto,
  UpdateAllergyStatusDto,
  UpdateDiagnosisStatusDto,
  UpdatePractitionerDto,
  VersionOnlyDto,
  WalkInDto,
} from "./clinic.dto";
import { AppointmentService } from "./appointments/appointment.service";
import { ClinicConfigService } from "./config/clinic-config.service";
import { ClinicDashboardService } from "./dashboard/clinic-dashboard.service";
import { EncounterService } from "./encounters/encounter.service";
import { VisitService } from "./queue/visit.service";
import { TriageService } from "./triage/triage.service";

const facilityQuery = z.object({ facilityId: z.string().uuid() });
class FacilityQueryDto extends createZodDto(facilityQuery) {}
const exceptionsQuery = facilityQuery.extend({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) });
class ExceptionsQueryDto extends createZodDto(exceptionsQuery) {}
const scheduleQuery = z.object({ practitionerId: z.string().uuid().optional() });
class ScheduleQueryDto extends createZodDto(scheduleQuery) {}
const patientQuery = z.object({ patientId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(200).default(50) });
class PatientQueryDto extends createZodDto(patientQuery) {}
const reviewSchema = z.object({ noKnownAllergies: z.boolean() });
class AllergyReviewDto extends createZodDto(reviewSchema) {}

@ApiTags("clinic configuration")
@ApiBearerAuth()
@Controller({ path: "clinic", version: "1" })
export class ClinicConfigController {
  constructor(private readonly config: ClinicConfigService) {}

  @Get("practitioners")
  @RequirePermissions("appointment.read")
  practitioners(@CurrentActor() actor: Actor) {
    return this.config.listPractitioners(actor.organizationId);
  }

  @Post("practitioners")
  @RequirePermissions("clinic.configure")
  createPractitioner(@CurrentActor() actor: Actor, @Body() body: CreatePractitionerDto) {
    return this.config.createPractitioner(actor, body);
  }

  @Patch("practitioners/:practitionerId")
  @RequirePermissions("clinic.configure")
  updatePractitioner(@CurrentActor() actor: Actor, @Param("practitionerId", ParseUUIDPipe) id: string, @Body() body: UpdatePractitionerDto) {
    return this.config.updatePractitioner(actor, id, body);
  }

  @Get("rooms")
  @RequirePermissions("appointment.read")
  rooms(@CurrentActor() actor: Actor, @Query() query: FacilityQueryDto) {
    return this.config.listRooms(actor.organizationId, query.facilityId);
  }

  @Post("rooms")
  @RequirePermissions("clinic.configure")
  createRoom(@CurrentActor() actor: Actor, @Body() body: CreateRoomDto) {
    return this.config.createRoom(actor, body);
  }

  @Get("visit-types")
  @RequirePermissions("appointment.read")
  visitTypes(@CurrentActor() actor: Actor) {
    return this.config.listVisitTypes(actor.organizationId);
  }

  @Post("visit-types")
  @RequirePermissions("clinic.configure")
  createVisitType(@CurrentActor() actor: Actor, @Body() body: CreateVisitTypeDto) {
    return this.config.createVisitType(actor, body);
  }

  @Patch("visit-types/:visitTypeId")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Rename, change duration, open or close for online booking, or deactivate a visit type" })
  updateVisitType(@CurrentActor() actor: Actor, @Param("visitTypeId", ParseUUIDPipe) id: string, @Body() body: UpdateVisitTypeDto) {
    return this.config.updateVisitType(actor, id, body);
  }

  @Get("coding-systems")
  @RequirePermissions("encounter.read")
  codingSystems(@CurrentActor() actor: Actor) {
    return this.config.listCodingSystems(actor.organizationId);
  }

  @Post("coding-systems")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Register a diagnosis coding system (e.g. the ICD-10 edition in use)" })
  createCodingSystem(@CurrentActor() actor: Actor, @Body() body: CreateCodingSystemDto) {
    return this.config.createCodingSystem(actor, body);
  }

  @Get("schedules")
  @RequirePermissions("appointment.read")
  schedules(@CurrentActor() actor: Actor, @Query() query: ScheduleQueryDto) {
    return this.config.listSchedules(actor.organizationId, query.practitionerId);
  }

  @Post("schedules")
  @RequirePermissions("clinic.configure")
  createSchedule(@CurrentActor() actor: Actor, @Body() body: CreateScheduleDto) {
    return this.config.createSchedule(actor, body);
  }

  @Post("schedules/:scheduleId/retire")
  @HttpCode(200)
  @RequirePermissions("clinic.configure")
  retireSchedule(@CurrentActor() actor: Actor, @Param("scheduleId", ParseUUIDPipe) id: string) {
    return this.config.retireSchedule(actor, id);
  }

  @Get("schedule-exceptions")
  @RequirePermissions("appointment.read")
  exceptions(@CurrentActor() actor: Actor, @Query() query: ExceptionsQueryDto) {
    return this.config.listExceptions(actor.organizationId, query.facilityId, new Date(query.from), new Date(query.to));
  }

  @Post("schedule-exceptions")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Practitioner leave, or a whole-facility closure such as a declared holiday" })
  createException(@CurrentActor() actor: Actor, @Body() body: CreateExceptionDto) {
    return this.config.createException(actor, body);
  }
}

@ApiTags("appointments")
@ApiBearerAuth()
@Controller({ version: "1" })
export class AppointmentController {
  constructor(
    private readonly appointments: AppointmentService,
    private readonly visits: VisitService,
  ) {}

  @Get("appointments/availability")
  @RequirePermissions("appointment.read")
  availability(@CurrentActor() actor: Actor, @Query() query: AvailabilityQueryDto) {
    return this.appointments.availability(actor, query);
  }

  @Get("appointments")
  @RequirePermissions("appointment.read")
  list(@CurrentActor() actor: Actor, @Query() query: ListAppointmentsDto) {
    return this.appointments.list(actor, query);
  }

  @Post("appointments")
  @RequirePermissions("appointment.manage")
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiOperation({ summary: "Book an appointment or a recurring series (409 slot_unavailable on double-booking)" })
  book(@CurrentActor() actor: Actor, @Body() body: BookAppointmentDto) {
    return this.appointments.book(actor, body);
  }

  @Get("appointments/:appointmentId")
  @RequirePermissions("appointment.read")
  get(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) id: string) {
    return this.appointments.get(actor, id);
  }

  @Post("appointments/:appointmentId/confirm")
  @HttpCode(200)
  @RequirePermissions("appointment.manage")
  confirm(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) id: string, @Body() body: VersionOnlyDto) {
    return this.appointments.confirm(actor, id, body.version);
  }

  @Post("appointments/:appointmentId/reschedule")
  @HttpCode(200)
  @RequirePermissions("appointment.manage")
  reschedule(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) id: string, @Body() body: RescheduleDto) {
    return this.appointments.reschedule(actor, id, body);
  }

  @Post("appointments/:appointmentId/cancel")
  @HttpCode(200)
  @RequirePermissions("appointment.manage")
  cancel(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) id: string, @Body() body: CancelAppointmentDto) {
    return this.appointments.cancel(actor, id, body);
  }

  @Post("appointments/:appointmentId/no-show")
  @HttpCode(200)
  @RequirePermissions("appointment.manage")
  noShow(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) id: string, @Body() body: VersionOnlyDto) {
    return this.appointments.markNoShow(actor, id, body.version);
  }

  @Post("appointments/:appointmentId/check-in")
  @RequirePermissions("clinic.queue.manage")
  @RequireFacility()
  @ApiOperation({ summary: "Patient arrived: check in and add to the facility queue" })
  checkIn(@CurrentActor() actor: Actor, @Param("appointmentId", ParseUUIDPipe) id: string, @Body() body: CheckInDto) {
    return this.visits.checkInAppointment(actor, id, body);
  }

  @Get("waitlist")
  @RequirePermissions("appointment.read")
  waitlist(@CurrentActor() actor: Actor, @Query() query: FacilityQueryDto) {
    return this.appointments.listWaitlist(actor, query.facilityId);
  }

  @Post("waitlist")
  @RequirePermissions("appointment.manage")
  addToWaitlist(@CurrentActor() actor: Actor, @Body() body: CreateWaitlistDto) {
    return this.appointments.addToWaitlist(actor, body);
  }

  @Post("waitlist/:entryId/close")
  @HttpCode(200)
  @RequirePermissions("appointment.manage")
  closeWaitlist(@CurrentActor() actor: Actor, @Param("entryId", ParseUUIDPipe) id: string, @Body() body: CloseWaitlistDto) {
    return this.appointments.closeWaitlistEntry(actor, id, body);
  }
}

@ApiTags("queue")
@ApiBearerAuth()
@Controller({ path: "queue", version: "1" })
export class QueueController {
  constructor(
    private readonly visits: VisitService,
    private readonly triage: TriageService,
  ) {}

  @Get()
  @RequirePermissions("clinic.queue.read")
  @RequireFacility()
  @ApiOperation({ summary: "The facility queue in service order (priority, then arrival)" })
  queue(@CurrentActor() actor: Actor, @Query() query: QueueQueryDto) {
    return this.visits.queue(actor, { date: query.date, includeClosed: query.includeClosed === "true" });
  }

  @Post("walk-ins")
  @RequirePermissions("clinic.queue.manage")
  @RequireFacility()
  @ApiHeader({ name: "Idempotency-Key", required: false })
  walkIn(@CurrentActor() actor: Actor, @Body() body: WalkInDto) {
    return this.visits.walkIn(actor, body);
  }

  @Get("visits/:visitId")
  @RequirePermissions("clinic.queue.read")
  get(@CurrentActor() actor: Actor, @Param("visitId", ParseUUIDPipe) id: string) {
    return this.visits.get(actor, id);
  }

  @Post("visits/:visitId/move")
  @HttpCode(200)
  @RequirePermissions("clinic.queue.manage")
  move(@CurrentActor() actor: Actor, @Param("visitId", ParseUUIDPipe) id: string, @Body() body: MoveVisitDto) {
    return this.visits.move(actor, id, body);
  }

  @Post("visits/:visitId/call")
  @HttpCode(200)
  @RequirePermissions("clinic.queue.manage")
  call(@CurrentActor() actor: Actor, @Param("visitId", ParseUUIDPipe) id: string, @Body() body: CallVisitDto) {
    return this.visits.call(actor, id, body);
  }

  @Post("visits/:visitId/assign")
  @HttpCode(200)
  @RequirePermissions("clinic.queue.manage")
  assign(@CurrentActor() actor: Actor, @Param("visitId", ParseUUIDPipe) id: string, @Body() body: AssignVisitDto) {
    return this.visits.assign(actor, id, body);
  }

  @Post("visits/:visitId/triage")
  @RequirePermissions("clinic.triage.write")
  @ApiOperation({ summary: "Record triage (chief complaint, priority, risk flags, vital signs)" })
  recordTriage(@CurrentActor() actor: Actor, @Param("visitId", ParseUUIDPipe) id: string, @Body() body: TriageDto) {
    return this.triage.triage(actor, id, body);
  }
}

@ApiTags("clinical records")
@ApiBearerAuth()
@Controller({ version: "1" })
export class ClinicalRecordsController {
  constructor(private readonly triage: TriageService) {}

  @Post("vital-signs")
  @RequirePermissions("clinic.triage.write")
  recordVitals(@CurrentActor() actor: Actor, @Body() body: RecordVitalsDto) {
    return this.triage.recordVitals(actor, body);
  }

  @Get("vital-signs")
  @RequirePermissions("clinical.read")
  @ApiOperation({ summary: "Vital-sign history of a patient, newest first" })
  vitals(@CurrentActor() actor: Actor, @Query() query: PatientQueryDto) {
    return this.triage.vitalsHistory(actor, query.patientId, query.limit);
  }

  @Post("vital-signs/:vitalsId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("clinic.triage.write")
  vitalsInError(@CurrentActor() actor: Actor, @Param("vitalsId", ParseUUIDPipe) id: string, @Body() body: EnteredInErrorDto) {
    return this.triage.markVitalsInError(actor, id, body.reason);
  }

  @Get("patients/:patientId/allergies")
  @RequirePermissions("clinical.read")
  allergies(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.triage.allergies(actor, patientId);
  }

  @Post("patients/:patientId/allergies")
  @RequirePermissions("allergy.manage")
  addAllergy(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: CreateAllergyDto) {
    return this.triage.addAllergy(actor, patientId, body);
  }

  @Patch("patients/:patientId/allergies/:allergyId")
  @RequirePermissions("allergy.manage")
  updateAllergy(
    @CurrentActor() actor: Actor,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("allergyId", ParseUUIDPipe) allergyId: string,
    @Body() body: UpdateAllergyStatusDto,
  ) {
    return this.triage.updateAllergyStatus(actor, patientId, allergyId, body);
  }

  @Post("patients/:patientId/allergy-reviews")
  @RequirePermissions("allergy.manage")
  @ApiOperation({ summary: "Record that allergies were reviewed (optionally: no known allergies)" })
  reviewAllergies(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: AllergyReviewDto) {
    return this.triage.reviewAllergies(actor, patientId, body.noKnownAllergies);
  }
}

@ApiTags("encounters")
@ApiBearerAuth()
@Controller({ path: "encounters", version: "1" })
export class EncounterController {
  constructor(private readonly encounters: EncounterService) {}

  @Post()
  @RequirePermissions("encounter.write")
  @ApiOperation({ summary: "Start a consultation from a queue visit (or directly for a patient)" })
  start(@CurrentActor() actor: Actor, @Body() body: StartEncounterDto) {
    return this.encounters.start(actor, body);
  }

  @Get()
  @RequirePermissions("encounter.read")
  list(@CurrentActor() actor: Actor, @Query() query: ListEncountersDto) {
    return this.encounters.listForPatient(actor, query.patientId, query);
  }

  @Get(":encounterId")
  @RequirePermissions("encounter.read")
  get(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string) {
    return this.encounters.get(actor, id);
  }

  @Get(":encounterId/revisions")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Full note history: drafts, signed version and amendments" })
  revisions(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string) {
    return this.encounters.history(actor, id);
  }

  @Put(":encounterId/note")
  @RequirePermissions("encounter.write")
  saveNote(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string, @Body() body: SaveNoteDto) {
    return this.encounters.saveDraft(actor, id, body);
  }

  @Post(":encounterId/sign")
  @HttpCode(200)
  @RequirePermissions("encounter.sign")
  sign(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string, @Body() body: SignEncounterDto) {
    return this.encounters.sign(actor, id, body.version);
  }

  @Post(":encounterId/amendments")
  @RequirePermissions("encounter.amend")
  amend(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string, @Body() body: AmendNoteDto) {
    return this.encounters.amend(actor, id, body);
  }

  @Post(":encounterId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("encounter.write")
  enteredInError(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string, @Body() body: EnteredInErrorDto) {
    return this.encounters.markEnteredInError(actor, id, body.reason);
  }

  @Post(":encounterId/diagnoses")
  @RequirePermissions("encounter.write")
  addDiagnosis(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string, @Body() body: AddDiagnosisDto) {
    return this.encounters.addDiagnosis(actor, id, body);
  }

  @Post(":encounterId/diagnoses/:diagnosisId/status")
  @HttpCode(200)
  @RequirePermissions("encounter.write")
  diagnosisStatus(
    @CurrentActor() actor: Actor,
    @Param("encounterId", ParseUUIDPipe) id: string,
    @Param("diagnosisId", ParseUUIDPipe) diagnosisId: string,
    @Body() body: UpdateDiagnosisStatusDto,
  ) {
    return this.encounters.updateDiagnosisStatus(actor, id, diagnosisId, body);
  }
}

@ApiTags("clinic dashboard")
@ApiBearerAuth()
@Controller({ path: "clinic/dashboard", version: "1" })
export class ClinicDashboardController {
  constructor(private readonly dashboard: ClinicDashboardService) {}

  @Get()
  @RequirePermissions("clinic.dashboard.read")
  @RequireFacility()
  get(@CurrentActor() actor: Actor, @Query() query: DashboardQueryDto) {
    return this.dashboard.forFacility(actor, query.date);
  }
}
