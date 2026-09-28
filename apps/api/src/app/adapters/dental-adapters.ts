import { Injectable } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { ClinicQueries } from "@healthcare/clinic";
import { type Actor, type DbExecutor, localDate } from "@healthcare/core";
import {
  type DentalContext,
  type DentalPatientBrief,
  DENTAL_SUPPLY_CATEGORIES,
  DENTAL_SUPPLY_SOURCE,
  type DentalSupplies,
  type DentalSupplyIssue,
  type DentalSupplyReturn,
  type DentalVisit,
} from "@healthcare/dental";
import { InventoryQueries, InventoryStockService } from "@healthcare/inventory";
import { OrganizationService } from "@healthcare/organization";
import { PatientRecordService } from "@healthcare/patient";

/** Dental → clinic, patient and staff directory: the dental visit is a clinic encounter with a dentist. */
@Injectable()
export class AppDentalContext implements DentalContext {
  constructor(
    private readonly clinic: ClinicQueries,
    private readonly patients: PatientRecordService,
    private readonly users: UsersService,
  ) {}

  async encounter(organizationId: string, encounterId: string) {
    const row = await this.clinic.encounter(organizationId, encounterId);
    return row ? { id: row.id, patientId: row.patientId, facilityId: row.facilityId, practitionerId: row.practitionerId, status: row.status } : undefined;
  }

  async practitionerForUser(organizationId: string, userId: string) {
    const row = await this.clinic.practitionerForUser(organizationId, userId);
    return row ? { id: row.id, displayName: row.displayName, profession: row.profession } : undefined;
  }

  practitionerNames(organizationId: string, practitionerIds: string[]) {
    return this.clinic.practitionerNames(organizationId, practitionerIds);
  }

  staffNames(organizationId: string, userIds: string[]) {
    return this.users.displayNames(organizationId, userIds);
  }

  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, DentalPatientBrief>> {
    return this.patients.briefs(organizationId, patientIds);
  }

  dentalVisits(organizationId: string, facilityId: string, date: string): Promise<DentalVisit[]> {
    return this.clinic.encountersOfProfession(organizationId, facilityId, date, "dentist");
  }
}

/**
 * Dental → inventory: the supplies a procedure used are issued (and unused ones returned) by the inventory's own
 * commands inside the transaction dentistry passes, with the procedure as the ledger movement's source.
 */
@Injectable()
export class AppDentalSupplies implements DentalSupplies {
  constructor(
    private readonly queries: InventoryQueries,
    private readonly stock: InventoryStockService,
    private readonly organizations: OrganizationService,
  ) {}

  items(organizationId: string, itemIds?: string[]) {
    return this.queries.items(organizationId, itemIds);
  }

  locations(organizationId: string, facilityId: string) {
    return this.queries.locations(organizationId, facilityId);
  }

  location(organizationId: string, locationId: string) {
    return this.queries.location(organizationId, locationId);
  }

  async usableStock(organizationId: string, facilityId: string) {
    const facility = await this.organizations.getFacility(organizationId, facilityId);
    return this.queries.usableStock(organizationId, facilityId, localDate(new Date(), facility.timezone));
  }

  issue(tx: DbExecutor, actor: Actor, input: DentalSupplyIssue) {
    return this.stock.issueForSource(tx, actor, {
      locationId: input.locationId,
      source: { type: DENTAL_SUPPLY_SOURCE.type, id: input.procedureId },
      issuedTo: DENTAL_SUPPLY_SOURCE.issuedTo,
      categories: DENTAL_SUPPLY_CATEGORIES,
      lines: input.lines,
      idempotencyKey: input.idempotencyKey,
    });
  }

  return(tx: DbExecutor, actor: Actor, input: DentalSupplyReturn) {
    return this.stock.returnForSource(tx, actor, {
      locationId: input.locationId,
      source: { type: DENTAL_SUPPLY_SOURCE.type, id: input.procedureId },
      lines: input.lines,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
