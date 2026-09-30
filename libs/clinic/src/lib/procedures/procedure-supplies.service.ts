import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
  outstandingByLine,
  requireFacilityId,
  returnIssues,
  supplyLineIssues,
} from "@healthcare/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { procedureSupplyTemplateSchema, recordProcedureSuppliesSchema, returnProcedureSuppliesSchema } from "./procedure.dto";
import {
  clinicProcedure,
  clinicProcedureDefinition,
  type ClinicProcedureRecord,
  clinicProcedureSupplyTemplateItem,
  clinicProcedureSupplyUse,
  clinicProcedureSupplyUseLine,
  type ProcedureSupplyUseKind,
  type ProcedureSupplyUseLineRecord,
  type ProcedureSupplyUseRecord,
} from "./procedure.schema";
import { found } from "../clinic-support";
import { CLINIC_SUPPLY_CATEGORIES, PROCEDURE_SUPPLIES, type ProcedureSupplies, type ProcedureSupplyMovement } from "./ports";

/**
 * Supplies a clinic procedure used, taken from inventory (docs/domains/clinic.md, "Procedures"; the dental pattern).
 * Templates per catalogue entry are configuration; staff confirm what was actually used and from which stock location.
 * The inventory posts the issue with its own rules through the `ProcedureSupplies` port inside this service's
 * transaction, so the clinic's record of the use and the ledger commit together or not at all. Used material is
 * consumed: nothing returns to stock automatically, not even when the procedure is entered in error — unused supplies
 * come back through an explicit return (with a reason).
 */
@Injectable()
export class ProcedureSuppliesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    @Inject(PROCEDURE_SUPPLIES) private readonly supplies: ProcedureSupplies,
  ) {}

  // ---- configuration ---------------------------------------------------------------------------

  /**
   * What the supplies picker and the template editor need: the organization's active items a clinic procedure may use
   * (medical supplies, medicines, PPE, other), templates per catalogue entry and, with a selected facility, its active
   * stock locations and usable stock.
   */
  async options(actor: Actor) {
    const org = actor.organizationId;
    const facilityId = actor.facilityId ?? null;
    const [items, templates, locations, stock] = await Promise.all([
      this.supplies.items(org),
      this.templates(org),
      facilityId ? this.supplies.locations(org, facilityId) : Promise.resolve([]),
      facilityId ? this.supplies.usableStock(org, facilityId) : Promise.resolve([]),
    ]);
    const active = locations.filter((l) => l.status === "active");
    return {
      facilityId,
      locations: active.map((l) => ({ id: l.id, code: l.code, name: l.name })),
      items: items
        .filter((i) => i.status === "active" && (CLINIC_SUPPLY_CATEGORIES as readonly string[]).includes(i.category))
        .map((i) => ({
          ...i,
          usable: Object.fromEntries(stock.filter((s) => s.itemId === i.id).map((s) => [s.locationId, s.usable])),
        })),
      templates,
    };
  }

  /** Replaces a catalogue entry's supply template (an empty list clears it). Audited with before and after. */
  async setTemplate(actor: Actor, definitionId: string, input: z.infer<typeof procedureSupplyTemplateSchema>) {
    const org = actor.organizationId;
    const [definition] = await this.db
      .select()
      .from(clinicProcedureDefinition)
      .where(and(eq(clinicProcedureDefinition.organizationId, org), eq(clinicProcedureDefinition.id, definitionId)));
    found(definition, "Procedure");
    const items = await this.supplies.items(
      org,
      input.items.map((i) => i.itemId),
    );
    rejectIssues(
      supplyLineIssues(input.items, new Map(items.map((i) => [i.id, i])), { allowEmpty: true, ...CATEGORY_RULE }),
      "The supply template is not valid",
      "invalid_supply_template",
    );
    return this.db.transaction(async (tx) => {
      const previous = await tx
        .select({ itemId: clinicProcedureSupplyTemplateItem.inventoryItemId, quantity: clinicProcedureSupplyTemplateItem.quantity })
        .from(clinicProcedureSupplyTemplateItem)
        .where(and(eq(clinicProcedureSupplyTemplateItem.organizationId, org), eq(clinicProcedureSupplyTemplateItem.definitionId, definitionId)))
        .orderBy(asc(clinicProcedureSupplyTemplateItem.position))
        .for("update");
      await tx
        .delete(clinicProcedureSupplyTemplateItem)
        .where(and(eq(clinicProcedureSupplyTemplateItem.organizationId, org), eq(clinicProcedureSupplyTemplateItem.definitionId, definitionId)));
      if (input.items.length) {
        await tx.insert(clinicProcedureSupplyTemplateItem).values(
          input.items.map((i, position) => ({
            organizationId: org,
            definitionId,
            inventoryItemId: i.itemId,
            quantity: i.quantity,
            position,
            updatedBy: actor.userId,
          })),
        );
      }
      await this.audit.record(tx, actor, {
        action: "clinic.procedure-supply-template.update",
        resourceType: "clinic_procedure_definition",
        resourceId: definitionId,
        changes: { items: { from: previous, to: input.items } },
      });
      return { definitionId, items: input.items };
    });
  }

  // ---- use ---------------------------------------------------------------------------------------

  /**
   * Records the supplies a procedure used and issues them from stock in one transaction. Idempotent by the request's
   * key: a retry returns the use it already recorded. A refusal from inventory (not enough usable stock, an expired
   * lot, a controlled item without reason and reference) rolls everything back.
   */
  async record(actor: Actor, procedureId: string, input: z.infer<typeof recordProcedureSuppliesSchema>) {
    const replay = await this.replay(actor, input.idempotencyKey, procedureId, "issue");
    if (replay) return replay;
    const facilityId = requireFacilityId(actor);
    try {
      const useId = await this.db.transaction(async (tx) => {
        const procedure = await this.lockProcedure(tx, actor, procedureId, facilityId);
        if (procedure.enteredInErrorAt) {
          throw new BusinessRuleError("The procedure is entered in error; return unused supplies instead", "procedure_entered_in_error");
        }
        const items = await this.supplies.items(
          actor.organizationId,
          input.lines.map((l) => l.itemId),
        );
        rejectIssues(
          supplyLineIssues(input.lines, new Map(items.map((i) => [i.id, i])), { allowEmpty: false, ...CATEGORY_RULE }),
          "The supplies are not recorded correctly",
          "invalid_supplies",
        );
        const id = randomUUID();
        const issued = await this.supplies.issue(tx, actor, {
          locationId: input.locationId,
          procedureId,
          lines: input.lines,
          idempotencyKey: `clinic-procedure-supply-${id}`,
        });
        await tx.insert(clinicProcedureSupplyUse).values({
          id,
          organizationId: actor.organizationId,
          facilityId: procedure.facilityId,
          patientId: procedure.patientId,
          procedureId,
          kind: "issue",
          locationId: input.locationId,
          movementGroupId: issued.movementGroupId,
          idempotencyKey: input.idempotencyKey,
          recordedBy: actor.userId,
        });
        await tx.insert(clinicProcedureSupplyUseLine).values(issued.movements.map((m) => lineValues(actor.organizationId, id, m, null)));
        await this.audit.record(tx, actor, {
          action: "clinic.procedure-supplies.issue",
          resourceType: "clinic_procedure",
          resourceId: procedureId,
          patientId: procedure.patientId,
          metadata: {
            supplyUseId: id,
            locationId: input.locationId,
            movementGroupId: issued.movementGroupId,
            lines: issued.movements.map((m) => ({ itemId: m.itemId, lotId: m.lotId, quantity: m.quantity })),
          },
        });
        await this.events.record(tx, {
          type: "ClinicProcedureSuppliesIssued",
          organizationId: actor.organizationId,
          aggregateType: "clinic_procedure",
          aggregateId: procedureId,
          facilityId: procedure.facilityId,
          patientId: procedure.patientId,
          payload: { supplyUseId: id, movementGroupId: issued.movementGroupId, lines: issued.movements.length },
        });
        return id;
      });
      return this.view(actor.organizationId, useId);
    } catch (error) {
      const retried = await this.afterUniqueViolation(error, actor, input.idempotencyKey, procedureId, "issue");
      if (retried) return retried;
      throw error;
    }
  }

  /**
   * Returns unused supplies of a procedure to the lots and location they came from (also after the procedure was
   * entered in error). Never more than is still out per issued line; a reason is required. Idempotent by key.
   */
  async returnUnused(actor: Actor, procedureId: string, input: z.infer<typeof returnProcedureSuppliesSchema>) {
    const replay = await this.replay(actor, input.idempotencyKey, procedureId, "return");
    if (replay) return replay;
    const facilityId = requireFacilityId(actor);
    try {
      const useId = await this.db.transaction(async (tx) => {
        const procedure = await this.lockProcedure(tx, actor, procedureId, facilityId);
        const uses = await tx
          .select()
          .from(clinicProcedureSupplyUse)
          .where(and(eq(clinicProcedureSupplyUse.organizationId, actor.organizationId), eq(clinicProcedureSupplyUse.procedureId, procedureId)));
        const lines = uses.length
          ? await tx
              .select()
              .from(clinicProcedureSupplyUseLine)
              .where(
                and(
                  eq(clinicProcedureSupplyUseLine.organizationId, actor.organizationId),
                  inArray(
                    clinicProcedureSupplyUseLine.supplyUseId,
                    uses.map((u) => u.id),
                  ),
                ),
              )
          : [];
        const issueUse = new Map(uses.filter((u) => u.kind === "issue").map((u) => [u.id, u]));
        const issuedLines = lines.filter((l) => issueUse.has(l.supplyUseId));
        const outstanding = outstandingByLine(
          issuedLines,
          lines.filter((l) => l.returnsLineId).map((l) => ({ returnsLineId: l.returnsLineId!, quantity: l.quantity })),
        );
        rejectIssues(returnIssues(input.lines, outstanding), "These supplies cannot be returned", "invalid_supply_return");
        const requested = input.lines.map((r) => ({ ...r, line: issuedLines.find((l) => l.id === r.lineId)! }));
        const locations = new Set(requested.map((r) => issueUse.get(r.line.supplyUseId)!.locationId));
        if (locations.size !== 1) throw new BusinessRuleError("Return supplies to one stock location at a time", "return_one_location");
        const locationId = [...locations][0]!;
        // The inventory takes one line per lot: lines of the same lot (from separate issues) are added together.
        const byLot = new Map<string, { itemId: string; lotId: string; quantity: number }>();
        for (const r of requested) {
          const current = byLot.get(r.line.inventoryLotId);
          if (current) current.quantity += r.quantity;
          else byLot.set(r.line.inventoryLotId, { itemId: r.line.inventoryItemId, lotId: r.line.inventoryLotId, quantity: r.quantity });
        }
        const id = randomUUID();
        const returned = await this.supplies.return(tx, actor, {
          locationId,
          procedureId,
          lines: [...byLot.values()].map((l) => ({ ...l, reason: input.reason, ...(input.reference ? { reference: input.reference } : {}) })),
          idempotencyKey: `clinic-procedure-supply-${id}`,
        });
        await tx.insert(clinicProcedureSupplyUse).values({
          id,
          organizationId: actor.organizationId,
          facilityId: procedure.facilityId,
          patientId: procedure.patientId,
          procedureId,
          kind: "return",
          locationId,
          reason: input.reason,
          movementGroupId: returned.movementGroupId,
          idempotencyKey: input.idempotencyKey,
          recordedBy: actor.userId,
        });
        await tx.insert(clinicProcedureSupplyUseLine).values(
          requested.map((r) => {
            const movement = returned.movements.find((m) => m.lotId === r.line.inventoryLotId)!;
            return lineValues(actor.organizationId, id, { ...movement, quantity: r.quantity }, r.line.id);
          }),
        );
        await this.audit.record(tx, actor, {
          action: "clinic.procedure-supplies.return",
          resourceType: "clinic_procedure",
          resourceId: procedureId,
          patientId: procedure.patientId,
          reason: input.reason,
          metadata: {
            supplyUseId: id,
            locationId,
            movementGroupId: returned.movementGroupId,
            lines: requested.map((r) => ({ lineId: r.lineId, itemId: r.line.inventoryItemId, lotId: r.line.inventoryLotId, quantity: r.quantity })),
          },
        });
        await this.events.record(tx, {
          type: "ClinicProcedureSuppliesReturned",
          organizationId: actor.organizationId,
          aggregateType: "clinic_procedure",
          aggregateId: procedureId,
          facilityId: procedure.facilityId,
          patientId: procedure.patientId,
          payload: { supplyUseId: id, movementGroupId: returned.movementGroupId, lines: requested.length },
        });
        return id;
      });
      return this.view(actor.organizationId, useId);
    } catch (error) {
      const retried = await this.afterUniqueViolation(error, actor, input.idempotencyKey, procedureId, "return");
      if (retried) return retried;
      throw error;
    }
  }

  // ---- read --------------------------------------------------------------------------------------

  /** Every supply use of a consultation's procedures (issues and returns), newest first, with lots and what is still out. */
  async forEncounter(organizationId: string, encounterId: string) {
    const procedures = await this.db
      .select({ id: clinicProcedure.id })
      .from(clinicProcedure)
      .where(and(eq(clinicProcedure.organizationId, organizationId), eq(clinicProcedure.encounterId, encounterId)));
    if (!procedures.length) return [];
    const uses = await this.db
      .select()
      .from(clinicProcedureSupplyUse)
      .where(
        and(
          eq(clinicProcedureSupplyUse.organizationId, organizationId),
          inArray(
            clinicProcedureSupplyUse.procedureId,
            procedures.map((p) => p.id),
          ),
        ),
      );
    return this.views(organizationId, uses);
  }

  // ---- internals ---------------------------------------------------------------------------------

  private async view(organizationId: string, useId: string) {
    const [use] = await this.db
      .select()
      .from(clinicProcedureSupplyUse)
      .where(and(eq(clinicProcedureSupplyUse.organizationId, organizationId), eq(clinicProcedureSupplyUse.id, useId)));
    const [view] = await this.views(organizationId, [found(use, "Supply use")]);
    return view!;
  }

  private async views(organizationId: string, uses: ProcedureSupplyUseRecord[]) {
    if (!uses.length) return [];
    const procedureIds = [...new Set(uses.map((u) => u.procedureId))];
    // What is still out is computed across all uses of these procedures (a return may follow in a later request).
    const allUses = await this.db
      .select()
      .from(clinicProcedureSupplyUse)
      .where(and(eq(clinicProcedureSupplyUse.organizationId, organizationId), inArray(clinicProcedureSupplyUse.procedureId, procedureIds)));
    const lines = await this.db
      .select()
      .from(clinicProcedureSupplyUseLine)
      .where(
        and(
          eq(clinicProcedureSupplyUseLine.organizationId, organizationId),
          inArray(
            clinicProcedureSupplyUseLine.supplyUseId,
            allUses.map((u) => u.id),
          ),
        ),
      );
    const outstanding = outstandingByLine(
      lines.filter((l) => !l.returnsLineId),
      lines.filter((l) => l.returnsLineId).map((l) => ({ returnsLineId: l.returnsLineId!, quantity: l.quantity })),
    );
    const locationIds = [...new Set(uses.map((u) => u.locationId))];
    const locations = await Promise.all(locationIds.map((id) => this.supplies.location(organizationId, id)));
    const locationName = new Map(locations.filter((l) => l !== undefined).map((l) => [l.id, l.name]));
    return [...uses]
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
      .map((u) => ({
        id: u.id,
        procedureId: u.procedureId,
        kind: u.kind,
        locationId: u.locationId,
        locationName: locationName.get(u.locationId) ?? null,
        reason: u.reason,
        recordedBy: u.recordedBy,
        recordedAt: u.recordedAt.toISOString(),
        lines: lines
          .filter((l) => l.supplyUseId === u.id)
          .sort(
            (a, b) =>
              a.itemName.localeCompare(b.itemName) ||
              (a.expiryDate ?? "9999-12-31").localeCompare(b.expiryDate ?? "9999-12-31") ||
              (a.lotNumber ?? "").localeCompare(b.lotNumber ?? ""),
          )
          .map((l) => ({ ...lineView(l), outstanding: u.kind === "issue" ? (outstanding.get(l.id) ?? 0) : null })),
      }));
  }

  private async replay(actor: Actor, idempotencyKey: string, procedureId: string, kind: ProcedureSupplyUseKind) {
    const [use] = await this.db
      .select()
      .from(clinicProcedureSupplyUse)
      .where(and(eq(clinicProcedureSupplyUse.organizationId, actor.organizationId), eq(clinicProcedureSupplyUse.idempotencyKey, idempotencyKey)));
    if (!use) return null;
    if (use.procedureId !== procedureId || use.kind !== kind) {
      throw new BusinessRuleError("This idempotency key was already used for a different request", "idempotency_key_reused");
    }
    return this.view(actor.organizationId, use.id);
  }

  /** Two identical requests at once: the second waits on the unique key, fails, and returns the first one's result. */
  private async afterUniqueViolation(error: unknown, actor: Actor, idempotencyKey: string, procedureId: string, kind: ProcedureSupplyUseKind) {
    if (asPgError(error)?.constraint !== "clinic_procedure_supply_use_organization_id_idempotency_key_key") return null;
    return this.replay(actor, idempotencyKey, procedureId, kind);
  }

  /** The procedure (of the organization, at the selected facility), locked so its supply uses are recorded one at a time. */
  private async lockProcedure(tx: DbExecutor, actor: Actor, procedureId: string, facilityId: string): Promise<ClinicProcedureRecord> {
    const [row] = await tx
      .select()
      .from(clinicProcedure)
      .where(and(eq(clinicProcedure.organizationId, actor.organizationId), eq(clinicProcedure.id, procedureId)))
      .for("update");
    if (!row) throw new NotFoundError("Procedure");
    if (row.facilityId !== facilityId) throw new BusinessRuleError("The procedure was performed at another facility", "procedure_other_facility");
    return row;
  }

  private async templates(organizationId: string) {
    const rows = await this.db
      .select()
      .from(clinicProcedureSupplyTemplateItem)
      .where(eq(clinicProcedureSupplyTemplateItem.organizationId, organizationId))
      .orderBy(asc(clinicProcedureSupplyTemplateItem.definitionId), asc(clinicProcedureSupplyTemplateItem.position));
    const byDefinition = new Map<string, Array<{ itemId: string; quantity: number }>>();
    for (const r of rows) {
      const list = byDefinition.get(r.definitionId) ?? [];
      list.push({ itemId: r.inventoryItemId, quantity: r.quantity });
      byDefinition.set(r.definitionId, list);
    }
    return [...byDefinition].map(([definitionId, items]) => ({ definitionId, items }));
  }
}

const CATEGORY_RULE = { categories: CLINIC_SUPPLY_CATEGORIES, categoryLabel: "a supply clinic procedures use" } as const;

/** Refuses with the issues keyed by item or line, when there are any. */
function rejectIssues(issues: Record<string, string[]>, message: string, code: string): void {
  const entries = Object.entries(issues).filter(([, list]) => list.length);
  if (entries.length) throw new BusinessRuleError(message, code, Object.fromEntries(entries));
}

function lineValues(organizationId: string, supplyUseId: string, m: ProcedureSupplyMovement, returnsLineId: string | null) {
  return {
    organizationId,
    supplyUseId,
    inventoryItemId: m.itemId,
    inventoryLotId: m.lotId,
    inventoryMovementId: m.movementId,
    itemCode: m.itemCode,
    itemName: m.itemName,
    stockUnit: m.stockUnit,
    lotNumber: m.lotNumber,
    expiryDate: m.expiryDate,
    quantity: m.quantity,
    returnsLineId,
  };
}

function lineView(l: ProcedureSupplyUseLineRecord) {
  return {
    id: l.id,
    itemId: l.inventoryItemId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    stockUnit: l.stockUnit,
    lotId: l.inventoryLotId,
    lotNumber: l.lotNumber,
    expiryDate: l.expiryDate,
    quantity: l.quantity,
    returnsLineId: l.returnsLineId,
  };
}
