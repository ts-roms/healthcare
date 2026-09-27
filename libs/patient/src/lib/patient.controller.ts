import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, NotFoundError, RequireFacility, RequirePermissions } from "@healthcare/core";
import {
  AddAddressDto,
  AddContactDto,
  AddIdentifierDto,
  AddRelationshipDto,
  ChangeStatusDto,
  CommunicationPreferencesDto,
  DuplicateCheckDto,
  PatientSearchDto,
  RecordConsentDto,
  RegisterPatientDto,
  RetireDto,
  UpdateDemographicsDto,
} from "./patient.dto";
import { PatientRecordService } from "./patient-record.service";
import { PatientRegistrationService } from "./patient-registration.service";
import { PatientSearchService } from "./patient-search.service";

const SUB_RECORDS = { contacts: "contact", addresses: "address", identifiers: "identifier", relationships: "relationship" } as const;

@ApiTags("patients")
@ApiBearerAuth()
@Controller({ path: "patients", version: "1" })
export class PatientController {
  constructor(
    private readonly registration: PatientRegistrationService,
    private readonly search: PatientSearchService,
    private readonly records: PatientRecordService,
  ) {}

  @Get()
  @RequirePermissions("patient.search")
  @ApiOperation({ summary: "Patient lookup by name, patient number, mobile, birth date or identifier (minimal fields)" })
  find(@CurrentActor() actor: Actor, @Query() query: PatientSearchDto) {
    return this.search.search(actor, query);
  }

  @Post("duplicate-check")
  @HttpCode(200)
  @RequirePermissions("patient.register")
  @ApiOperation({ summary: "Find existing patients that may be the same person, before registering" })
  duplicateCheck(@CurrentActor() actor: Actor, @Body() body: DuplicateCheckDto) {
    return this.registration.checkDuplicates(actor, body);
  }

  @Post()
  @RequirePermissions("patient.register")
  @RequireFacility()
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "Makes retries of this request safe" })
  @ApiOperation({ summary: "Register a patient at the current facility (409 possible_duplicates if matches need review)" })
  async register(@CurrentActor() actor: Actor, @Body() body: RegisterPatientDto) {
    const created = await this.registration.register(actor, body);
    return { id: created.id, patientNumber: created.patientNumber, version: created.version };
  }

  @Get(":patientId")
  @RequirePermissions("patient.read")
  get(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.records.getDetail(actor, patientId);
  }

  @Patch(":patientId")
  @RequirePermissions("patient.update")
  async updateDemographics(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: UpdateDemographicsDto) {
    const updated = await this.records.updateDemographics(actor, patientId, body);
    return { id: updated.id, version: updated.version };
  }

  @Post(":patientId/status")
  @HttpCode(200)
  @RequirePermissions("patient.update")
  async changeStatus(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: ChangeStatusDto) {
    const updated = await this.records.changeStatus(actor, patientId, body);
    return { id: updated.id, status: updated.status, version: updated.version };
  }

  @Post(":patientId/contacts")
  @RequirePermissions("patient.update")
  addContact(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: AddContactDto) {
    return this.records.addContact(actor, patientId, body).then(pickId);
  }

  @Post(":patientId/addresses")
  @RequirePermissions("patient.update")
  addAddress(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: AddAddressDto) {
    return this.records.addAddress(actor, patientId, body).then(pickId);
  }

  @Post(":patientId/identifiers")
  @RequirePermissions("patient.update")
  addIdentifier(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: AddIdentifierDto) {
    return this.records.addIdentifier(actor, patientId, body).then(pickId);
  }

  @Post(":patientId/relationships")
  @RequirePermissions("patient.update")
  addRelationship(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: AddRelationshipDto) {
    return this.records.addRelationship(actor, patientId, body).then(pickId);
  }

  @Delete(":patientId/:collection/:recordId")
  @HttpCode(204)
  @RequirePermissions("patient.update")
  @ApiOperation({ summary: "Retire a contact, address, identifier or relationship (kept in history)" })
  async retire(
    @CurrentActor() actor: Actor,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("collection") collection: string,
    @Param("recordId", ParseUUIDPipe) recordId: string,
    @Body() body: RetireDto,
  ): Promise<void> {
    const kind = SUB_RECORDS[collection as keyof typeof SUB_RECORDS];
    if (!kind) throw new NotFoundError("Resource");
    await this.records.retire(actor, patientId, kind, recordId, body.reason);
  }

  @Get(":patientId/consents")
  @RequirePermissions("patient.read")
  @ApiOperation({ summary: "Full consent history (append-only)" })
  consents(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.records.consentHistory(actor, patientId);
  }

  @Post(":patientId/consents")
  @RequirePermissions("patient.consent.manage")
  recordConsent(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordConsentDto) {
    return this.records.recordConsent(actor, patientId, body);
  }

  @Put(":patientId/communication-preferences")
  @RequirePermissions("patient.consent.manage")
  setPreferences(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: CommunicationPreferencesDto) {
    return this.records.setCommunicationPreferences(actor, patientId, body);
  }
}

function pickId(record: { id: string } | undefined): { id: string | undefined } {
  return { id: record?.id };
}
