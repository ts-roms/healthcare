import { Injectable } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import {
  CLINIC_PROCEDURE_SUPPLY_SOURCE,
  CLINIC_SUPPLY_CATEGORIES,
  type ImmunizationContext,
  type ProcedureSupplies,
  type TakenVaccineStock,
  VACCINE_CATEGORIES,
  type VaccineStockLot,
} from "@healthcare/clinic";
import { type Actor, BusinessRuleError, type DbExecutor, localDate, NotFoundError } from "@healthcare/core";
import { InventoryQueries, InventoryStockService } from "@healthcare/inventory";
import { OrganizationService } from "@healthcare/organization";

/**
 * Immunizations (clinic) → auth and inventory: staff names, and vaccine stock taken and given back inside the
 * immunization's own transaction (movement source `immunization`, once per record; only the clinic's vaccine
 * categories).
 */
@Injectable()
export class AppImmunizationContext implements ImmunizationContext {
  constructor(
    private readonly users: UsersService,
    private readonly stock: InventoryStockService,
    private readonly inventory: InventoryQueries,
    private readonly organizations: OrganizationService,
  ) {}

  staffNames(organizationId: string, userIds: string[]) {
    return this.users.displayNames(organizationId, userIds);
  }

  async vaccineStock(organizationId: string, facilityId: string): Promise<VaccineStockLot[]> {
    const facility = await this.organizations.getFacility(organizationId, facilityId);
    return this.inventory.usableLots(organizationId, facilityId, [...VACCINE_CATEGORIES], localDate(new Date(), facility.timezone));
  }

  async takeStock(
    tx: DbExecutor,
    actor: Actor,
    input: { immunizationId: string; locationId: string; lotId: string; quantity: number; reference: string },
  ): Promise<TakenVaccineStock> {
    const lot = await this.inventory.lot(actor.organizationId, input.lotId);
    if (!lot) throw new NotFoundError("Stock lot");
    const taken = await this.stock.consume(tx, actor, {
      locationId: input.locationId,
      itemId: lot.itemId,
      lotId: lot.lotId,
      quantity: input.quantity,
      source: { type: "immunization", id: input.immunizationId },
      issuedTo: "Immunization given",
      categories: VACCINE_CATEGORIES,
      reference: input.reference,
      reason: "Dose given (immunization record)",
    });
    const [used] = taken.lots;
    if (!used || taken.lots.length !== 1) throw new BusinessRuleError("A dose is taken from one lot", "stock_lot_split");
    return { movementGroupId: taken.movementGroupId, itemId: taken.item.id, itemName: taken.item.name, lotNumber: used.lotNumber, expiryDate: used.expiryDate };
  }

  async returnStock(tx: DbExecutor, actor: Actor, input: { immunizationId: string; reason: string }) {
    const result = await this.stock.restore(tx, actor, { source: { type: "immunization", id: input.immunizationId }, reason: input.reason });
    return { movementGroupId: result.movementGroupId };
  }
}

/**
 * Clinic procedures → inventory: the supplies a procedure used are issued (and unused ones returned) by the inventory's
 * own commands inside the transaction the clinic passes, with the procedure as the ledger movement's source.
 */
@Injectable()
export class AppProcedureSupplies implements ProcedureSupplies {
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

  issue(tx: DbExecutor, actor: Actor, input: Parameters<ProcedureSupplies["issue"]>[2]) {
    return this.stock.issueForSource(tx, actor, {
      locationId: input.locationId,
      source: { type: CLINIC_PROCEDURE_SUPPLY_SOURCE.type, id: input.procedureId },
      issuedTo: CLINIC_PROCEDURE_SUPPLY_SOURCE.issuedTo,
      categories: CLINIC_SUPPLY_CATEGORIES,
      lines: input.lines,
      idempotencyKey: input.idempotencyKey,
    });
  }

  return(tx: DbExecutor, actor: Actor, input: Parameters<ProcedureSupplies["return"]>[2]) {
    return this.stock.returnForSource(tx, actor, {
      locationId: input.locationId,
      source: { type: CLINIC_PROCEDURE_SUPPLY_SOURCE.type, id: input.procedureId },
      lines: input.lines,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
