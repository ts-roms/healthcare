import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, ConflictError, DATABASE, type Database, localDayBounds, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { registerBalances } from "../inventory.rules";
import {
  inventoryBalance,
  inventoryControlledRegisterSetting,
  inventoryItem,
  inventoryLocation,
  inventoryLot,
  inventoryMovement,
  inventoryProcurementMethod,
  inventoryWithholdingCode,
  type ProcurementMethodRecord,
  type WithholdingCodeRecord,
} from "../inventory.schema";
import { assertVersion, found, strip } from "../inventory-support";
import type {
  controlledRegisterQuerySchema,
  controlledRegisterSettingSchema,
  createProcurementMethodSchema,
  createWithholdingCodeSchema,
} from "../procurement/procurement.dto";

/**
 * The organization's own tax and procurement configuration for inventory (withholding codes, procurement methods) and
 * the register of controlled items (docs/architecture/compliance-configuration.md). Nothing here encodes a BIR,
 * Dangerous Drugs Board or public procurement rule: codes, methods, references and what the register header says are
 * the organization's, to be validated by its advisers (compliance reviews).
 */
@Injectable()
export class InventoryComplianceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  // ---- withholding codes ----------------------------------------------------------------------------------------------

  async withholdingCodes(organizationId: string, activeOnly = false) {
    const conditions = [eq(inventoryWithholdingCode.organizationId, organizationId)];
    if (activeOnly) conditions.push(eq(inventoryWithholdingCode.status, "active"));
    const rows = await this.db
      .select()
      .from(inventoryWithholdingCode)
      .where(and(...conditions))
      .orderBy(asc(inventoryWithholdingCode.status), asc(inventoryWithholdingCode.code));
    return rows.map(strip);
  }

  async createWithholdingCode(actor: Actor, input: z.infer<typeof createWithholdingCodeSchema>) {
    return this.db.transaction(async (tx) => {
      const [row] = (await tx
        .insert(inventoryWithholdingCode)
        .values({ organizationId: actor.organizationId, ...input, createdBy: actor.userId })
        .onConflictDoNothing()
        .returning()) as WithholdingCodeRecord[];
      if (!row) throw new ConflictError(`An active withholding code ${input.code} exists`, undefined, "code_exists");
      await this.audit.record(tx, actor, {
        action: "inventory.withholding-code.create",
        resourceType: "inventory_withholding_code",
        resourceId: row.id,
        metadata: { code: row.code, rateBasisPoints: row.rateBasisPoints },
      });
      return strip(row);
    });
  }

  async deactivateWithholdingCode(actor: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(inventoryWithholdingCode)
        .set({ status: "inactive" })
        .where(and(eq(inventoryWithholdingCode.organizationId, actor.organizationId), eq(inventoryWithholdingCode.id, id)))
        .returning();
      const code = found(row, "Withholding code");
      await this.audit.record(tx, actor, {
        action: "inventory.withholding-code.deactivate",
        resourceType: "inventory_withholding_code",
        resourceId: id,
        metadata: { code: code.code },
      });
      return strip(code);
    });
  }

  // ---- procurement methods --------------------------------------------------------------------------------------------

  async procurementMethods(organizationId: string, activeOnly = false) {
    const conditions = [eq(inventoryProcurementMethod.organizationId, organizationId)];
    if (activeOnly) conditions.push(eq(inventoryProcurementMethod.status, "active"));
    const rows = await this.db
      .select()
      .from(inventoryProcurementMethod)
      .where(and(...conditions))
      .orderBy(asc(inventoryProcurementMethod.status), asc(inventoryProcurementMethod.code));
    return rows.map(strip);
  }

  async createProcurementMethod(actor: Actor, input: z.infer<typeof createProcurementMethodSchema>) {
    return this.db.transaction(async (tx) => {
      const [row] = (await tx
        .insert(inventoryProcurementMethod)
        .values({ organizationId: actor.organizationId, ...input, createdBy: actor.userId })
        .onConflictDoNothing()
        .returning()) as ProcurementMethodRecord[];
      if (!row) throw new ConflictError(`An active procurement method ${input.code} exists`, undefined, "code_exists");
      await this.audit.record(tx, actor, {
        action: "inventory.procurement-method.create",
        resourceType: "inventory_procurement_method",
        resourceId: row.id,
        metadata: { code: row.code, name: row.name, referenceLabel: row.referenceLabel },
      });
      return strip(row);
    });
  }

  async deactivateProcurementMethod(actor: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(inventoryProcurementMethod)
        .set({ status: "inactive" })
        .where(and(eq(inventoryProcurementMethod.organizationId, actor.organizationId), eq(inventoryProcurementMethod.id, id)))
        .returning();
      const method = found(row, "Procurement method");
      await this.audit.record(tx, actor, {
        action: "inventory.procurement-method.deactivate",
        resourceType: "inventory_procurement_method",
        resourceId: id,
        metadata: { code: method.code },
      });
      return strip(method);
    });
  }

  // ---- register of controlled items -------------------------------------------------------------------------------------

  /** The selected facility's register header (licence reference and responsible person as recorded); version 0 when unset. */
  async registerSetting(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const [row] = await this.db
      .select()
      .from(inventoryControlledRegisterSetting)
      .where(and(eq(inventoryControlledRegisterSetting.organizationId, actor.organizationId), eq(inventoryControlledRegisterSetting.facilityId, facilityId)));
    return row
      ? { ...strip(row), updatedAt: row.updatedAt.toISOString() }
      : { facilityId, licenceReference: null, responsiblePerson: null, note: null, updatedBy: null, updatedAt: null, version: 0 };
  }

  async setRegisterSetting(actor: Actor, input: z.infer<typeof controlledRegisterSettingSchema>) {
    const facilityId = requireFacilityId(actor);
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(inventoryControlledRegisterSetting)
        .where(and(eq(inventoryControlledRegisterSetting.organizationId, actor.organizationId), eq(inventoryControlledRegisterSetting.facilityId, facilityId)))
        .for("update");
      assertVersion(current?.version ?? 0, input.version, "Register setting");
      const values = {
        licenceReference: input.licenceReference,
        responsiblePerson: input.responsiblePerson,
        note: input.note,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (current) {
        await tx
          .update(inventoryControlledRegisterSetting)
          .set({ ...values, version: current.version + 1 })
          .where(eq(inventoryControlledRegisterSetting.facilityId, facilityId));
      } else {
        await tx.insert(inventoryControlledRegisterSetting).values({ organizationId: actor.organizationId, facilityId, ...values });
      }
      await this.audit.record(tx, actor, {
        action: "inventory.controlled-register.setting",
        resourceType: "facility",
        resourceId: facilityId,
        changes: {
          licenceReference: { from: current?.licenceReference ?? null, to: input.licenceReference },
          responsiblePerson: { from: current?.responsiblePerson ?? null, to: input.responsiblePerson },
        },
      });
    });
    return this.registerSetting(actor);
  }

  /**
   * The register of controlled items at the selected facility for a period of local dates: per item and location, the
   * balance before the period, every movement in it (oldest first) with its reference, recipient, reason and who
   * recorded it, and the running and closing balances. Read from the stock ledger (append-only); nothing is re-entered.
   * Not audited here: the caller audits (it adds staff names).
   */
  async controlledRegister(actor: Actor, query: z.infer<typeof controlledRegisterQuerySchema>) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const start = localDayBounds(query.from, facility.timezone).start;
    const end = localDayBounds(query.to, facility.timezone).end;
    const locationConditions = [eq(inventoryLocation.organizationId, actor.organizationId), eq(inventoryLocation.facilityId, facilityId)];
    if (query.locationId) locationConditions.push(eq(inventoryLocation.id, query.locationId));
    const locations = await this.db
      .select({ id: inventoryLocation.id, code: inventoryLocation.code, name: inventoryLocation.name })
      .from(inventoryLocation)
      .where(and(...locationConditions))
      .orderBy(asc(inventoryLocation.name));
    const itemConditions = [eq(inventoryItem.organizationId, actor.organizationId), eq(inventoryItem.controlled, true)];
    if (query.itemId) itemConditions.push(eq(inventoryItem.id, query.itemId));
    const items = await this.db
      .select({ id: inventoryItem.id, code: inventoryItem.code, name: inventoryItem.name, stockUnit: inventoryItem.stockUnit })
      .from(inventoryItem)
      .where(and(...itemConditions))
      .orderBy(asc(inventoryItem.name));
    const setting = await this.registerSetting(actor);
    const base = { facility: { id: facility.id, name: facility.name, timezone: facility.timezone }, from: query.from, to: query.to, setting };
    if (!locations.length || !items.length) return { ...base, sections: [] };
    const locationIds = locations.map((l) => l.id);
    const itemIds = items.map((i) => i.id);

    const [movements, balances, sinceStart] = await Promise.all([
      this.db
        .select({ movement: inventoryMovement, lotNumber: inventoryLot.lotNumber, expiryDate: inventoryLot.expiryDate })
        .from(inventoryMovement)
        .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryMovement.lotId))
        .where(
          and(
            eq(inventoryMovement.organizationId, actor.organizationId),
            inArray(inventoryMovement.itemId, itemIds),
            inArray(inventoryMovement.locationId, locationIds),
            gte(inventoryMovement.recordedAt, start),
            lt(inventoryMovement.recordedAt, end),
          ),
        )
        .orderBy(asc(inventoryMovement.recordedAt), asc(inventoryMovement.id)),
      // Today's balances, less everything since the period started, give the balance before it.
      this.db
        .select({ itemId: inventoryBalance.itemId, locationId: inventoryBalance.locationId, quantity: sql<number>`sum(${inventoryBalance.quantity})::int` })
        .from(inventoryBalance)
        .where(
          and(
            eq(inventoryBalance.organizationId, actor.organizationId),
            inArray(inventoryBalance.itemId, itemIds),
            inArray(inventoryBalance.locationId, locationIds),
          ),
        )
        .groupBy(inventoryBalance.itemId, inventoryBalance.locationId),
      this.db
        .select({ itemId: inventoryMovement.itemId, locationId: inventoryMovement.locationId, quantity: sql<number>`sum(${inventoryMovement.quantity})::int` })
        .from(inventoryMovement)
        .where(
          and(
            eq(inventoryMovement.organizationId, actor.organizationId),
            inArray(inventoryMovement.itemId, itemIds),
            inArray(inventoryMovement.locationId, locationIds),
            gte(inventoryMovement.recordedAt, start),
          ),
        )
        .groupBy(inventoryMovement.itemId, inventoryMovement.locationId),
    ]);
    const key = (itemId: string, locationId: string) => `${itemId}:${locationId}`;
    const now = new Map(balances.map((b) => [key(b.itemId, b.locationId), Number(b.quantity)]));
    const moved = new Map(sinceStart.map((m) => [key(m.itemId, m.locationId), Number(m.quantity)]));
    const sections = [];
    for (const item of items) {
      for (const location of locations) {
        const k = key(item.id, location.id);
        const own = movements.filter((m) => m.movement.itemId === item.id && m.movement.locationId === location.id);
        const opening = (now.get(k) ?? 0) - (moved.get(k) ?? 0);
        // Items never held at a location are left out.
        if (!own.length && opening === 0) continue;
        const { lines, closing } = registerBalances(
          opening,
          own.map((m) => ({ ...m.movement, lotNumber: m.lotNumber, expiryDate: m.expiryDate })),
        );
        sections.push({
          item,
          location,
          opening,
          closing,
          received: lines.filter((l) => l.quantity > 0).reduce((sum, l) => sum + l.quantity, 0),
          removed: lines.filter((l) => l.quantity < 0).reduce((sum, l) => sum - l.quantity, 0),
          lines: lines.map((l) => ({
            id: l.movement.id,
            recordedAt: l.movement.recordedAt.toISOString(),
            kind: l.movement.kind,
            quantity: l.quantity,
            balance: l.balance,
            lotNumber: l.movement.lotNumber,
            expiryDate: l.movement.expiryDate,
            reference: l.movement.reference,
            issuedTo: l.movement.issuedTo,
            reason: l.movement.reason,
            sourceType: l.movement.sourceType,
            recordedBy: l.movement.recordedBy,
          })),
        });
      }
    }
    return { ...base, sections };
  }
}
