import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, asPgError, ConflictError, DATABASE, type Database, type DbExecutor, NotFoundError, PgErrorCode } from "@healthcare/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { orderSetSchema, updateOrderSetSchema } from "../laboratory.dto";
import {
  type CatalogStatus,
  labOrderSet,
  labOrderSetItem,
  labOrderSetTrigger,
  labPanel,
  labPanelTest,
  labTest,
  type OrderSetTriggerKind,
} from "../laboratory.schema";
import { assertVersion, found } from "../laboratory-support";

export interface OrderSetItemView {
  kind: "test" | "panel";
  id: string;
  code: string;
  name: string;
  status: CatalogStatus;
  /** The tests it orders: the test itself, or the panel's members. */
  testIds: string[];
}

export interface OrderSetView {
  id: string;
  code: string;
  name: string;
  note: string | null;
  status: CatalogStatus;
  version: number;
  updatedAt: string;
  items: OrderSetItemView[];
  triggers: Array<{ kind: OrderSetTriggerKind; value: string; codeSystemKey: string | null }>;
}

type OrderSetInput = z.infer<typeof orderSetSchema>;
type OrderSetUpdate = z.infer<typeof updateOrderSetSchema>;

/** How a trigger is stored: diagnosis code prefixes upper case, visit type codes lower case, so matching is exact. */
export function normalizeTrigger(trigger: OrderSetInput["triggers"][number]): { kind: OrderSetTriggerKind; value: string; codeSystemKey: string | null } {
  return trigger.kind === "diagnosis_code"
    ? { kind: "diagnosis_code", value: trigger.value.trim().toUpperCase(), codeSystemKey: trigger.codeSystemKey?.trim() || null }
    : { kind: "visit_type", value: trigger.value.trim().toLowerCase(), codeSystemKey: null };
}

/**
 * Order sets (docs/domains/laboratory.md, "Order sets"): the organization's own lists of tests and panels ordered
 * together, optionally offered for a diagnosis code prefix or a visit type. Configuration only — an order set orders
 * nothing; the order form pre-selects its tests and the doctor places the order.
 */
@Injectable()
export class LabOrderSetService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, includeInactive = false): Promise<OrderSetView[]> {
    const sets = await this.db
      .select()
      .from(labOrderSet)
      .where(and(eq(labOrderSet.organizationId, organizationId), includeInactive ? undefined : eq(labOrderSet.status, "active")))
      .orderBy(asc(labOrderSet.name));
    return this.views(this.db, organizationId, sets);
  }

  async get(organizationId: string, id: string): Promise<OrderSetView> {
    const [set] = await this.db
      .select()
      .from(labOrderSet)
      .where(and(eq(labOrderSet.organizationId, organizationId), eq(labOrderSet.id, id)));
    return (await this.views(this.db, organizationId, [found(set, "Order set")]))[0]!;
  }

  async create(actor: Actor, input: OrderSetInput): Promise<OrderSetView> {
    try {
      return await this.db.transaction(async (tx) => {
        const items = await this.checkedItems(tx, actor.organizationId, input.items);
        const [row] = await tx
          .insert(labOrderSet)
          .values({
            organizationId: actor.organizationId,
            code: input.code,
            name: input.name,
            note: input.note ?? null,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })
          .returning();
        const set = found(row, "Order set");
        await this.writeParts(tx, actor.organizationId, set.id, items, input.triggers);
        await this.audit.record(tx, actor, {
          action: "lab.order-set.create",
          resourceType: "lab_order_set",
          resourceId: set.id,
          metadata: { code: set.code, items: items.length, triggers: input.triggers.length },
        });
        return (await this.views(tx, actor.organizationId, [set]))[0]!;
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new ConflictError("An order set with that code exists", undefined, "duplicate_code");
      throw error;
    }
  }

  /** Replaces the name, note, items and triggers, and may deactivate or reactivate the set. */
  async update(actor: Actor, id: string, input: OrderSetUpdate): Promise<OrderSetView> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(labOrderSet)
        .where(and(eq(labOrderSet.organizationId, actor.organizationId), eq(labOrderSet.id, id)))
        .for("update");
      const set = found(current, "Order set");
      assertVersion(set.version, input.version, "Order set");
      const items = await this.checkedItems(tx, actor.organizationId, input.items);
      const [row] = await tx
        .update(labOrderSet)
        .set({ name: input.name, note: input.note ?? null, status: input.status, updatedBy: actor.userId, updatedAt: new Date(), version: set.version + 1 })
        .where(eq(labOrderSet.id, id))
        .returning();
      await tx.delete(labOrderSetItem).where(eq(labOrderSetItem.orderSetId, id));
      await tx.delete(labOrderSetTrigger).where(eq(labOrderSetTrigger.orderSetId, id));
      await this.writeParts(tx, actor.organizationId, id, items, input.triggers);
      await this.audit.record(tx, actor, {
        action: "lab.order-set.update",
        resourceType: "lab_order_set",
        resourceId: id,
        metadata: { code: set.code, status: input.status, items: items.length, triggers: input.triggers.length, version: set.version + 1 },
      });
      return (await this.views(tx, actor.organizationId, [row!]))[0]!;
    });
  }

  // ---- internals -----------------------------------------------------------------------------------------------------

  /** The items without repeats, each an active test or panel of the organization. */
  private async checkedItems(tx: DbExecutor, organizationId: string, items: OrderSetInput["items"]) {
    const seen = new Set<string>();
    const unique = items.filter((item) => {
      const key = "testId" in item ? `t:${item.testId}` : `p:${item.panelId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const testIds = unique.flatMap((i) => ("testId" in i ? [i.testId] : []));
    const panelIds = unique.flatMap((i) => ("panelId" in i ? [i.panelId] : []));
    if (testIds.length) {
      const tests = await tx
        .select({ id: labTest.id })
        .from(labTest)
        .where(and(eq(labTest.organizationId, organizationId), inArray(labTest.id, testIds), eq(labTest.status, "active")));
      if (tests.length !== testIds.length) throw new NotFoundError("One or more active laboratory tests");
    }
    if (panelIds.length) {
      const panels = await tx
        .select({ id: labPanel.id })
        .from(labPanel)
        .where(and(eq(labPanel.organizationId, organizationId), inArray(labPanel.id, panelIds), eq(labPanel.status, "active")));
      if (panels.length !== panelIds.length) throw new NotFoundError("One or more active laboratory panels");
    }
    return unique;
  }

  private async writeParts(tx: DbExecutor, organizationId: string, orderSetId: string, items: OrderSetInput["items"], triggers: OrderSetInput["triggers"]) {
    await tx.insert(labOrderSetItem).values(
      items.map((item, index) => ({
        organizationId,
        orderSetId,
        position: index + 1,
        testId: "testId" in item ? item.testId : null,
        panelId: "panelId" in item ? item.panelId : null,
      })),
    );
    const distinct = new Map(triggers.map(normalizeTrigger).map((t) => [`${t.kind}|${t.value}|${t.codeSystemKey ?? ""}`, t]));
    if (distinct.size) await tx.insert(labOrderSetTrigger).values([...distinct.values()].map((t) => ({ organizationId, orderSetId, ...t })));
  }

  private async views(executor: DbExecutor, organizationId: string, sets: Array<typeof labOrderSet.$inferSelect>): Promise<OrderSetView[]> {
    if (sets.length === 0) return [];
    const ids = sets.map((s) => s.id);
    const items = await executor
      .select()
      .from(labOrderSetItem)
      .where(and(eq(labOrderSetItem.organizationId, organizationId), inArray(labOrderSetItem.orderSetId, ids)))
      .orderBy(asc(labOrderSetItem.position));
    const triggers = await executor
      .select()
      .from(labOrderSetTrigger)
      .where(and(eq(labOrderSetTrigger.organizationId, organizationId), inArray(labOrderSetTrigger.orderSetId, ids)));
    const testIds = [...new Set(items.flatMap((i) => (i.testId ? [i.testId] : [])))];
    const panelIds = [...new Set(items.flatMap((i) => (i.panelId ? [i.panelId] : [])))];
    const tests = testIds.length
      ? await executor
          .select({ id: labTest.id, code: labTest.code, name: labTest.name, status: labTest.status })
          .from(labTest)
          .where(inArray(labTest.id, testIds))
      : [];
    const panels = panelIds.length
      ? await executor
          .select({ id: labPanel.id, code: labPanel.code, name: labPanel.name, status: labPanel.status })
          .from(labPanel)
          .where(inArray(labPanel.id, panelIds))
      : [];
    const members = panelIds.length
      ? await executor
          .select({ panelId: labPanelTest.panelId, testId: labPanelTest.testId })
          .from(labPanelTest)
          .where(inArray(labPanelTest.panelId, panelIds))
          .orderBy(asc(labPanelTest.position))
      : [];
    return sets.map((set) => ({
      id: set.id,
      code: set.code,
      name: set.name,
      note: set.note,
      status: set.status,
      version: set.version,
      updatedAt: set.updatedAt.toISOString(),
      items: items
        .filter((i) => i.orderSetId === set.id)
        .flatMap((i): OrderSetItemView[] => {
          if (i.testId) {
            const test = tests.find((t) => t.id === i.testId);
            return test ? [{ kind: "test", id: test.id, code: test.code, name: test.name, status: test.status, testIds: [test.id] }] : [];
          }
          const panel = panels.find((p) => p.id === i.panelId);
          return panel
            ? [
                {
                  kind: "panel",
                  id: panel.id,
                  code: panel.code,
                  name: panel.name,
                  status: panel.status,
                  testIds: members.filter((m) => m.panelId === panel.id).map((m) => m.testId),
                },
              ]
            : [];
        }),
      triggers: triggers
        .filter((t) => t.orderSetId === set.id)
        .map((t) => ({ kind: t.kind, value: t.value, codeSystemKey: t.codeSystemKey }))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value)),
    }));
  }
}
