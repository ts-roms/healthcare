import { Injectable } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { ClinicQueries } from "@healthcare/clinic";
import type { Actor, DbExecutor } from "@healthcare/core";
import { InventoryQueries, InventoryStockService } from "@healthcare/inventory";
import { type LaboratoryContext, type LabPatientBrief, REAGENT_CATEGORY } from "@healthcare/laboratory";
import { PatientRecordService } from "@healthcare/patient";

/**
 * Laboratory → patient, clinic, staff directory and inventory: identification, demographics, ordering provider,
 * encounter state, and the reagent lots the laboratory loads on its instruments.
 */
@Injectable()
export class AppLaboratoryContext implements LaboratoryContext {
  constructor(
    private readonly patients: PatientRecordService,
    private readonly clinic: ClinicQueries,
    private readonly users: UsersService,
    private readonly inventory: InventoryQueries,
    private readonly stock: InventoryStockService,
  ) {}

  laboratoryStaff(organizationId: string, facilityId: string) {
    return this.users.holdersOf(organizationId, "lab.result.enter", facilityId);
  }

  async takeReagentStock(
    tx: DbExecutor,
    actor: Actor,
    input: { loadId: string; locationId: string; itemId: string; lotId: string; quantity: number; instrumentCode: string },
  ) {
    const result = await this.stock.consume(tx, actor, {
      locationId: input.locationId,
      itemId: input.itemId,
      lotId: input.lotId,
      quantity: input.quantity,
      source: { type: "lab_reagent_load", id: input.loadId },
      issuedTo: `Laboratory instrument ${input.instrumentCode}`,
      categories: [REAGENT_CATEGORY],
      reference: input.instrumentCode,
      reason: "Loaded on a laboratory instrument",
    });
    return { movementGroupId: result.movementGroupId };
  }

  inventoryLot(organizationId: string, lotId: string) {
    return this.inventory.lot(organizationId, lotId);
  }

  reagentLotsInStock(organizationId: string, facilityId: string) {
    return this.inventory.lotsInStock(organizationId, facilityId, [REAGENT_CATEGORY]);
  }

  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, LabPatientBrief>> {
    return this.patients.briefs(organizationId, patientIds);
  }

  patientDemographics(organizationId: string, patientId: string) {
    return this.patients.demographics(organizationId, patientId);
  }

  async practitionerForUser(organizationId: string, userId: string) {
    const practitioner = await this.clinic.practitionerForUser(organizationId, userId);
    return practitioner ? { id: practitioner.id, displayName: practitioner.displayName } : undefined;
  }

  practitionerNames(organizationId: string, practitionerIds: string[]) {
    return this.clinic.practitionerNames(organizationId, practitionerIds);
  }

  staffNames(organizationId: string, userIds: string[]) {
    return this.users.displayNames(organizationId, userIds);
  }

  async encounter(organizationId: string, encounterId: string) {
    const row = await this.clinic.encounter(organizationId, encounterId);
    return row ? { id: row.id, patientId: row.patientId, facilityId: row.facilityId, status: row.status, modality: row.modality } : undefined;
  }
}
