import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  NotFoundError,
  PgErrorCode,
} from "@healthcare/core";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  addPriceSchema,
  createDiscountRuleSchema,
  createPayerSchema,
  createServiceSchema,
  updateServiceSchema,
  updateSettingsSchema,
  updateTaxProfileSchema,
} from "../billing.dto";
import {
  billingDiscountRule,
  billingOrganizationProfile,
  billingPayer,
  billingSequence,
  billingService,
  billingServicePrice,
  type SequenceKind,
  type ServiceSourceKind,
} from "../billing.schema";
import { assertVersion, found, previousDay, publicView } from "../billing-support";

export const DEFAULT_PREFIXES = { invoice: "INV", receipt: "AR", credit_note: "CN", debit_note: "DN" } as const;

const SERVICE_FIELDS = ["name", "status", "taxClass"] as const;
const TAX_PROFILE_FIELDS = [
  "registeredName",
  "tin",
  "businessAddress",
  "vatStatus",
  "vatRateBp",
  "permitReference",
  "documentNote",
  "depositsAcrossFacilities",
] as const;

/** Billable services with versioned prices, payers (HMO, PhilHealth, insurers), discount rules and document numbering. */
@Injectable()
export class BillingCatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---- services and prices ------------------------------------------------------------------

  /** Services with their price history, newest first; `currentPrice` is the price on `onDate`. */
  async listServices(organizationId: string, onDate: string) {
    const services = await this.db.select().from(billingService).where(eq(billingService.organizationId, organizationId)).orderBy(asc(billingService.name));
    const prices = services.length
      ? await this.db
          .select()
          .from(billingServicePrice)
          .where(
            inArray(
              billingServicePrice.serviceId,
              services.map((s) => s.id),
            ),
          )
          .orderBy(desc(billingServicePrice.effectiveFrom))
      : [];
    return services.map((s) => {
      const history = prices.filter((p) => p.serviceId === s.id).map(publicView);
      const current = history.find((p) => p.effectiveFrom <= onDate && (p.effectiveUntil === null || p.effectiveUntil >= onDate));
      return { ...publicView(s), currentPrice: current?.unitPrice ?? null, prices: history };
    });
  }

  async createService(actor: Actor, input: z.infer<typeof createServiceSchema>) {
    const { unitPrice, effectiveFrom, ...service } = input;
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(billingService)
          .values({ ...service, sourceKind: service.sourceKind ?? null, sourceCode: service.sourceCode ?? null, organizationId: actor.organizationId })
          .returning();
        const row = found(created, "Service");
        await tx
          .insert(billingServicePrice)
          .values({ organizationId: actor.organizationId, serviceId: row.id, unitPrice, effectiveFrom, createdBy: actor.userId });
        await this.audit.record(tx, actor, {
          action: "billing.service.create",
          resourceType: "billing_service",
          resourceId: row.id,
          metadata: { code: row.code, category: row.category, unitPrice, effectiveFrom, source: row.sourceKind ? `${row.sourceKind}:${row.sourceCode}` : null },
        });
        return publicView(row);
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new ConflictError("A service with this code, or for this visit type or test, already exists", undefined, "service_exists");
      }
      throw error;
    }
  }

  async updateService(actor: Actor, serviceId: string, input: z.infer<typeof updateServiceSchema>) {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(billingService)
        .where(and(eq(billingService.organizationId, actor.organizationId), eq(billingService.id, serviceId)))
        .for("update");
      const current = found(before, "Service");
      assertVersion(current.version, version, "Service");
      const [updated] = await tx
        .update(billingService)
        .set({ ...changes, version: sql`${billingService.version} + 1` })
        .where(eq(billingService.id, serviceId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "billing.service.update",
        resourceType: "billing_service",
        resourceId: serviceId,
        changes: diffChanges(current, changes, SERVICE_FIELDS),
      });
      return publicView(found(updated, "Service"));
    });
  }

  /**
   * A new price from a date. The price in force until then ends the day before;
   * prices already billed keep their snapshot on charges and invoices.
   */
  async addPrice(actor: Actor, serviceId: string, input: z.infer<typeof addPriceSchema>) {
    return this.db.transaction(async (tx) => {
      const [service] = await tx
        .select()
        .from(billingService)
        .where(and(eq(billingService.organizationId, actor.organizationId), eq(billingService.id, serviceId)))
        .for("update");
      found(service, "Service");
      const [later] = await tx
        .select({ id: billingServicePrice.id })
        .from(billingServicePrice)
        .where(and(eq(billingServicePrice.serviceId, serviceId), gte(billingServicePrice.effectiveFrom, input.effectiveFrom)));
      if (later) throw new BusinessRuleError("A price already starts on or after this date; choose a later date", "price_date_conflict");
      await tx
        .update(billingServicePrice)
        .set({ effectiveUntil: previousDay(input.effectiveFrom) })
        .where(
          and(
            eq(billingServicePrice.serviceId, serviceId),
            or(isNull(billingServicePrice.effectiveUntil), gte(billingServicePrice.effectiveUntil, input.effectiveFrom)),
          ),
        );
      const [created] = await tx
        .insert(billingServicePrice)
        .values({ organizationId: actor.organizationId, serviceId, unitPrice: input.unitPrice, effectiveFrom: input.effectiveFrom, createdBy: actor.userId })
        .returning();
      await this.audit.record(tx, actor, {
        action: "billing.price.add",
        resourceType: "billing_service",
        resourceId: serviceId,
        metadata: { unitPrice: input.unitPrice, effectiveFrom: input.effectiveFrom },
      });
      return publicView(found(created, "Price"));
    });
  }

  /** The active service captured automatically for a visit type or laboratory test code. */
  async serviceForSource(executor: DbExecutor, organizationId: string, sourceKind: ServiceSourceKind, sourceCode: string) {
    const [row] = await executor
      .select()
      .from(billingService)
      .where(
        and(
          eq(billingService.organizationId, organizationId),
          eq(billingService.sourceKind, sourceKind),
          eq(billingService.sourceCode, sourceCode.toLowerCase()),
          eq(billingService.status, "active"),
        ),
      );
    return row;
  }

  async requireService(executor: DbExecutor, organizationId: string, serviceId: string) {
    const [row] = await executor
      .select()
      .from(billingService)
      .where(and(eq(billingService.organizationId, organizationId), eq(billingService.id, serviceId)));
    if (!row) throw new NotFoundError("Service");
    return row;
  }

  /** The price of a service on a local date, if one is set. */
  async priceOn(executor: DbExecutor, serviceId: string, date: string) {
    const [row] = await executor
      .select()
      .from(billingServicePrice)
      .where(
        and(
          eq(billingServicePrice.serviceId, serviceId),
          lte(billingServicePrice.effectiveFrom, date),
          or(isNull(billingServicePrice.effectiveUntil), gte(billingServicePrice.effectiveUntil, date)),
        ),
      );
    return row;
  }

  // ---- payers -------------------------------------------------------------------------------

  async listPayers(organizationId: string) {
    const rows = await this.db.select().from(billingPayer).where(eq(billingPayer.organizationId, organizationId)).orderBy(asc(billingPayer.name));
    return rows.map(publicView);
  }

  async createPayer(actor: Actor, input: z.infer<typeof createPayerSchema>) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(billingPayer)
        .values({ ...input, organizationId: actor.organizationId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Payer "${input.code}" already exists`, undefined, "payer_exists");
      await this.audit.record(tx, actor, {
        action: "billing.payer.create",
        resourceType: "billing_payer",
        resourceId: created.id,
        metadata: { type: created.payerType },
      });
      return publicView(created);
    });
  }

  // ---- discount rules -----------------------------------------------------------------------

  async listDiscountRules(organizationId: string) {
    const rows = await this.db
      .select()
      .from(billingDiscountRule)
      .where(eq(billingDiscountRule.organizationId, organizationId))
      .orderBy(asc(billingDiscountRule.name), desc(billingDiscountRule.effectiveFrom));
    return rows.map(publicView);
  }

  async createDiscountRule(actor: Actor, input: z.infer<typeof createDiscountRuleSchema>) {
    if (input.statutory && !input.requiresEvidence) {
      throw new BusinessRuleError("Statutory discounts need eligibility evidence (an ID number)", "evidence_required");
    }
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(billingDiscountRule)
        .values({ ...input, effectiveUntil: input.effectiveUntil ?? null, organizationId: actor.organizationId, createdBy: actor.userId })
        .returning();
      const row = found(created, "Discount rule");
      await this.audit.record(tx, actor, {
        action: "billing.discount-rule.create",
        resourceType: "billing_discount_rule",
        resourceId: row.id,
        metadata: { code: row.code, kind: row.kind, statutory: row.statutory, rateBp: row.rateBp, categories: row.categories },
      });
      return publicView(row);
    });
  }

  async deactivateDiscountRule(actor: Actor, ruleId: string) {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(billingDiscountRule)
        .set({ status: "inactive" })
        .where(and(eq(billingDiscountRule.organizationId, actor.organizationId), eq(billingDiscountRule.id, ruleId)))
        .returning();
      const row = found(updated, "Discount rule");
      await this.audit.record(tx, actor, { action: "billing.discount-rule.deactivate", resourceType: "billing_discount_rule", resourceId: ruleId });
      return publicView(row);
    });
  }

  // ---- document numbering -------------------------------------------------------------------

  async settings(organizationId: string) {
    const rows = await this.db.select().from(billingSequence).where(eq(billingSequence.organizationId, organizationId));
    const prefix = (kind: SequenceKind) => rows.find((r) => r.kind === kind)?.prefix ?? DEFAULT_PREFIXES[kind];
    return {
      invoicePrefix: prefix("invoice"),
      receiptPrefix: prefix("receipt"),
      creditNotePrefix: prefix("credit_note"),
      debitNotePrefix: prefix("debit_note"),
      /** Each series: the next number and the last one authorized (null = no limit configured). */
      series: (["invoice", "receipt", "credit_note", "debit_note"] as const).map((kind) => {
        const row = rows.find((r) => r.kind === kind);
        return { kind, prefix: prefix(kind), nextValue: row?.nextValue ?? 1, lastValue: row?.lastValue ?? null };
      }),
    };
  }

  async updateSettings(actor: Actor, input: z.infer<typeof updateSettingsSchema>) {
    await this.db.transaction(async (tx) => {
      const series: Array<[SequenceKind, string | undefined]> = [
        ["invoice", input.invoicePrefix],
        ["receipt", input.receiptPrefix],
        ["credit_note", input.creditNotePrefix],
        ["debit_note", input.debitNotePrefix],
      ];
      for (const [kind, lastValue] of Object.entries(input.lastNumbers ?? {}) as Array<[SequenceKind, number | null | undefined]>) {
        if (lastValue === undefined) continue;
        await tx.insert(billingSequence).values({ organizationId: actor.organizationId, kind, prefix: DEFAULT_PREFIXES[kind] }).onConflictDoNothing();
        const [current] = await tx
          .select()
          .from(billingSequence)
          .where(and(eq(billingSequence.organizationId, actor.organizationId), eq(billingSequence.kind, kind)))
          .for("update");
        if (lastValue !== null && current && lastValue < current.nextValue - 1) {
          throw new BusinessRuleError(`The last ${kind.replace("_", " ")} number cannot be below one already used`, "series_limit_below_used");
        }
        await tx
          .update(billingSequence)
          .set({ lastValue })
          .where(and(eq(billingSequence.organizationId, actor.organizationId), eq(billingSequence.kind, kind)));
      }
      for (const [kind, prefix] of series) {
        if (prefix === undefined) continue;
        await tx
          .insert(billingSequence)
          .values({ organizationId: actor.organizationId, kind, prefix })
          .onConflictDoUpdate({ target: [billingSequence.organizationId, billingSequence.kind], set: { prefix } });
      }
      await this.audit.record(tx, actor, { action: "billing.settings.update", resourceType: "billing_sequence", metadata: input });
    });
    return this.settings(actor.organizationId);
  }

  /** Takes the next number of a series (row-locked, so numbers are unique and gap-free within committed transactions). */
  async nextNumber(tx: DbExecutor, organizationId: string, kind: SequenceKind): Promise<{ prefix: string; value: number }> {
    await tx.insert(billingSequence).values({ organizationId, kind, prefix: DEFAULT_PREFIXES[kind] }).onConflictDoNothing();
    const [row] = await tx
      .update(billingSequence)
      .set({ nextValue: sql`${billingSequence.nextValue} + 1` })
      .where(and(eq(billingSequence.organizationId, organizationId), eq(billingSequence.kind, kind)))
      .returning({ prefix: billingSequence.prefix, taken: sql<number>`${billingSequence.nextValue} - 1`, lastValue: billingSequence.lastValue });
    const taken = found(row, "Number series");
    // The organization's authorized range is used up: no number is taken (the transaction rolls back).
    if (taken.lastValue !== null && Number(taken.taken) > taken.lastValue) {
      throw new BusinessRuleError(`The ${kind.replace("_", " ")} number series is used up; configure the next authorized range`, "number_series_exhausted", {
        kind,
        lastValue: taken.lastValue,
      });
    }
    return { prefix: taken.prefix, value: Number(taken.taken) };
  }

  // ---- tax profile (BIR as configuration) -----------------------------------------------------

  /** The organization's tax and document settings; "not configured" until entered. */
  async taxProfile(organizationId: string) {
    const [row] = await this.db.select().from(billingOrganizationProfile).where(eq(billingOrganizationProfile.organizationId, organizationId));
    if (row) return publicView(row);
    return {
      registeredName: null,
      tin: null,
      businessAddress: null,
      vatStatus: "not_configured" as const,
      vatRateBp: null,
      permitReference: null,
      documentNote: null,
      depositsAcrossFacilities: false,
      updatedBy: null,
      updatedAt: null,
      version: 0,
    };
  }

  async updateTaxProfile(actor: Actor, input: z.infer<typeof updateTaxProfileSchema>) {
    const { version, ...values } = input;
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(billingOrganizationProfile)
        .where(eq(billingOrganizationProfile.organizationId, actor.organizationId))
        .for("update");
      assertVersion(current?.version ?? 0, version ?? 0, "Tax profile");
      if (current) {
        await tx
          .update(billingOrganizationProfile)
          .set({ ...values, updatedBy: actor.userId, updatedAt: new Date(), version: sql`${billingOrganizationProfile.version} + 1` })
          .where(eq(billingOrganizationProfile.organizationId, actor.organizationId));
      } else {
        await tx.insert(billingOrganizationProfile).values({ ...values, organizationId: actor.organizationId, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: "billing.tax-profile.update",
        resourceType: "billing_organization_profile",
        resourceId: actor.organizationId,
        changes: diffChanges(current ?? {}, values, TAX_PROFILE_FIELDS),
      });
    });
    return this.taxProfile(actor.organizationId);
  }
}
