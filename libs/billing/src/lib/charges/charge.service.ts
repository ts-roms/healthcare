import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  requireFacilityId,
  systemActor,
  filedAsPatient,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { cancelChargeSchema, listChargesSchema, manualChargeSchema } from "../billing.dto";
import { billingCharge, type BillingChargeRecord, billingService, type ChargeSourceType, type ServiceSourceKind } from "../billing.schema";
import { chargeQuantity } from "../billing.rules";
import { assertVersion, found, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";
import { PackageService } from "../packages/package.service";
import { BILLING_PATIENTS, BILLING_SOURCES, type BillingPatientDirectory, type BillingSources } from "../ports";

interface CaptureInput {
  organizationId: string;
  facilityId: string;
  patientId: string;
  sourceType: Exclude<ChargeSourceType, "manual">;
  sourceId: string;
  sourceGroupId: string | null;
  sourceKind: ServiceSourceKind;
  sourceCode: string;
  description: string;
  serviceDate: string;
  /** Surfaces treated, for a service charged per surface (dental procedures). */
  surfaceCount?: number;
  /** How many were done (clinic procedures); otherwise from the charge unit. */
  quantity?: number;
}

/**
 * Charges: what a patient received that may be billed. Captured automatically
 * from clinical events (a signed encounter, a laboratory order) for services
 * mapped to the visit type or test, or entered by staff. Capture never blocks
 * the clinical workflow: unmapped or unpriced sources are simply not charged
 * (staff can add a manual charge). Each clinical source is charged once. A
 * package the patient bought at the facility covers included services: the
 * charge is recorded at zero against the package (PackageService).
 */
@Injectable()
export class ChargeService {
  private readonly logger = new Logger(ChargeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: BillingCatalogService,
    private readonly organizations: OrganizationService,
    private readonly packages: PackageService,
    @Inject(BILLING_SOURCES) private readonly sources: BillingSources,
    @Inject(BILLING_PATIENTS) private readonly patients: BillingPatientDirectory,
  ) {}

  // ---- automatic capture --------------------------------------------------------------------

  async captureEncounter(organizationId: string, encounterId: string): Promise<void> {
    const encounter = await this.sources.encounter(organizationId, encounterId);
    if (!encounter?.visitTypeCode) return;
    await this.capture({
      organizationId,
      facilityId: encounter.facilityId,
      patientId: encounter.patientId,
      sourceType: "encounter",
      sourceId: encounter.id,
      sourceGroupId: null,
      sourceKind: "visit_type",
      sourceCode: encounter.visitTypeCode,
      description: "",
      serviceDate: encounter.serviceDate,
    });
  }

  async captureLabOrder(organizationId: string, orderId: string): Promise<void> {
    const order = await this.sources.labOrder(organizationId, orderId);
    if (!order) return;
    for (const item of order.items) {
      await this.capture({
        organizationId,
        facilityId: order.facilityId,
        patientId: order.patientId,
        sourceType: "lab_order_item",
        sourceId: item.id,
        sourceGroupId: order.id,
        sourceKind: "lab_test",
        sourceCode: item.testCode,
        description: item.testName,
        serviceDate: order.serviceDate,
      });
    }
  }

  async captureDentalProcedure(organizationId: string, procedureId: string): Promise<void> {
    const procedure = await this.sources.dentalProcedure(organizationId, procedureId);
    if (!procedure) return;
    await this.capture({
      organizationId,
      facilityId: procedure.facilityId,
      patientId: procedure.patientId,
      sourceType: "dental_procedure",
      sourceId: procedure.id,
      sourceGroupId: null,
      sourceKind: "dental_procedure",
      sourceCode: procedure.procedureCode,
      description: procedure.description,
      serviceDate: procedure.serviceDate,
      surfaceCount: procedure.surfaceCount,
    });
  }

  /** A procedure performed at the clinic: charged by its code, the quantity as recorded. */
  async captureClinicProcedure(organizationId: string, procedureId: string): Promise<void> {
    const procedure = await this.sources.clinicProcedure(organizationId, procedureId);
    if (!procedure) return;
    await this.capture({
      organizationId,
      facilityId: procedure.facilityId,
      patientId: procedure.patientId,
      sourceType: "clinic_procedure",
      sourceId: procedure.id,
      sourceGroupId: null,
      sourceKind: "clinic_procedure",
      sourceCode: procedure.procedureCode,
      description: procedure.description,
      serviceDate: procedure.serviceDate,
      quantity: procedure.quantity,
    });
  }

  /** A clinic procedure marked entered in error: its charge not yet on an invoice is cancelled (an invoiced one needs a void). */
  async cancelClinicProcedure(organizationId: string, procedureId: string): Promise<void> {
    await this.cancelSourceCharges(
      organizationId,
      and(eq(billingCharge.sourceType, "clinic_procedure"), eq(billingCharge.sourceId, procedureId))!,
      "Procedure entered in error",
    );
  }

  /** A cancelled laboratory order: its charges not yet on an invoice are cancelled (invoiced ones need a void). */
  async cancelLabOrder(organizationId: string, orderId: string): Promise<void> {
    await this.cancelSourceCharges(organizationId, eq(billingCharge.sourceGroupId, orderId), "Laboratory order cancelled");
  }

  /** A dental procedure marked entered in error: its charge not yet on an invoice is cancelled (an invoiced one needs a void). */
  async cancelDentalProcedure(organizationId: string, procedureId: string): Promise<void> {
    await this.cancelSourceCharges(
      organizationId,
      and(eq(billingCharge.sourceType, "dental_procedure"), eq(billingCharge.sourceId, procedureId))!,
      "Dental procedure entered in error",
    );
  }

  private async cancelSourceCharges(organizationId: string, source: SQL, reason: string): Promise<void> {
    const actor = systemActor(organizationId, null, "billing-capture");
    await this.db.transaction(async (tx) => {
      const cancelled = await tx
        .update(billingCharge)
        .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date(), version: sql`${billingCharge.version} + 1` })
        .where(and(eq(billingCharge.organizationId, organizationId), source, eq(billingCharge.status, "pending")))
        .returning();
      for (const row of cancelled) {
        await this.audit.record(tx, actor, {
          action: "billing.charge.cancel",
          resourceType: "billing_charge",
          resourceId: row.id,
          patientId: row.patientId,
          reason: row.cancelReason ?? undefined,
        });
      }
    });
  }

  private async capture(input: CaptureInput): Promise<void> {
    const actor = systemActor(input.organizationId, input.facilityId, "billing-capture");
    await this.db.transaction(async (tx) => {
      const service = await this.catalog.serviceForSource(tx, input.organizationId, input.sourceKind, input.sourceCode);
      if (!service) return;
      const price = await this.catalog.priceOn(tx, service.id, input.serviceDate);
      if (!price) {
        this.logger.warn(`No price for service ${service.code} on ${input.serviceDate}; charge not captured`);
        return;
      }
      const quantity = input.quantity ?? chargeQuantity(service.chargeUnit, input.surfaceCount ?? 0);
      const cover = await this.packages.coverFor(tx, {
        organizationId: input.organizationId,
        facilityId: input.facilityId,
        patientId: input.patientId,
        serviceId: service.id,
        quantity,
        onDate: input.serviceDate,
      });
      const description = input.description || service.name;
      const [row] = await tx
        .insert(billingCharge)
        .values({
          organizationId: input.organizationId,
          facilityId: input.facilityId,
          patientId: input.patientId,
          serviceId: service.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceGroupId: input.sourceGroupId,
          description: cover ? coveredDescription(description, cover.packageName) : description,
          unitPrice: cover ? 0 : price.unitPrice,
          quantity,
          priceId: cover ? null : price.id,
          packageEnrollmentId: cover?.enrollmentId ?? null,
          serviceDate: input.serviceDate,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) return; // already captured (at-least-once delivery)
      await this.audit.record(tx, actor, {
        action: "billing.charge.capture",
        resourceType: "billing_charge",
        resourceId: row.id,
        patientId: row.patientId,
        metadata: {
          source: `${row.sourceType}:${row.sourceId}`,
          serviceCode: service.code,
          unitPrice: row.unitPrice,
          quantity: row.quantity,
          packageEnrollmentId: row.packageEnrollmentId,
        },
      });
      await this.events.record(tx, chargeEvent(row));
    });
  }

  // ---- staff --------------------------------------------------------------------------------

  async list(actor: Actor, query: z.infer<typeof listChargesSchema>) {
    const facilityId = requireFacilityId(actor);
    const filters: SQL[] = [eq(billingCharge.organizationId, actor.organizationId), eq(billingCharge.facilityId, facilityId)];
    if (query.patientId) filters.push(filedAsPatient(billingCharge.patientId, query.patientId));
    if (query.status) filters.push(eq(billingCharge.status, query.status));
    const rows = await this.db
      .select({ charge: billingCharge, serviceCode: billingService.code, category: billingService.category })
      .from(billingCharge)
      .innerJoin(billingService, eq(billingService.id, billingCharge.serviceId))
      .where(and(...filters))
      .orderBy(desc(billingCharge.capturedAt))
      .limit(500);
    const patients = await this.patients.summaries(actor.organizationId, [...new Set(rows.map((r) => r.charge.patientId))]);
    if (query.patientId) {
      await this.audit.recordStandalone(actor, { action: "billing.charge.list", resourceType: "billing_charge", patientId: query.patientId });
    }
    return rows.map((r) => ({ ...chargeView(r.charge), serviceCode: r.serviceCode, category: r.category, patient: patients.get(r.charge.patientId) ?? null }));
  }

  /** Patients with charges not yet invoiced at this facility: the cashier's worklist. */
  async pendingByPatient(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select({
        patientId: billingCharge.patientId,
        count: sql<number>`count(*)::int`,
        amount: sql<number>`sum(${billingCharge.unitPrice} * ${billingCharge.quantity})::bigint`,
        oldest: sql<string>`min(${billingCharge.serviceDate})`,
      })
      .from(billingCharge)
      .where(and(eq(billingCharge.organizationId, actor.organizationId), eq(billingCharge.facilityId, facilityId), eq(billingCharge.status, "pending")))
      .groupBy(billingCharge.patientId)
      .orderBy(sql`min(${billingCharge.capturedAt})`)
      .limit(200);
    const patients = await this.patients.summaries(
      actor.organizationId,
      rows.map((r) => r.patientId),
    );
    await this.audit.recordStandalone(actor, { action: "billing.worklist", resourceType: "billing_charge", metadata: { facilityId, count: rows.length } });
    return rows.map((r) => ({ ...r, amount: Number(r.amount), patient: patients.get(r.patientId) ?? null }));
  }

  async addManual(actor: Actor, input: z.infer<typeof manualChargeSchema>) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const serviceDate = input.serviceDate ?? localDate(new Date(), facility.timezone);
    return this.db.transaction(async (tx) => {
      const service = await this.catalog.requireService(tx, actor.organizationId, input.serviceId);
      if (service.status !== "active") throw new BusinessRuleError("This service is inactive", "service_inactive");
      if (service.isPackage) throw new BusinessRuleError("Packages are sold from the patient's packages, not added as a charge", "package_sold_separately");
      // A package the patient bought covers the service, unless staff give another price.
      const cover =
        input.usePackage && input.unitPrice === undefined
          ? await this.packages.coverFor(tx, {
              organizationId: actor.organizationId,
              facilityId,
              patientId: input.patientId,
              serviceId: service.id,
              quantity: input.quantity,
              onDate: serviceDate,
            })
          : null;
      const price = await this.catalog.priceOn(tx, service.id, serviceDate);
      let unitPrice = price?.unitPrice;
      if (input.unitPrice !== undefined && input.unitPrice !== price?.unitPrice) {
        if (price && !input.priceOverrideReason) {
          throw new BusinessRuleError("Changing the listed price needs a reason", "price_override_reason_required");
        }
        unitPrice = input.unitPrice;
      }
      if (cover) unitPrice = 0;
      if (unitPrice === undefined) throw new BusinessRuleError("This service has no price for the date; enter one", "price_required");
      const [created] = await tx
        .insert(billingCharge)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId: input.patientId,
          serviceId: service.id,
          sourceType: "manual",
          description: cover ? coveredDescription(input.description ?? service.name, cover.packageName) : (input.description ?? service.name),
          quantity: input.quantity,
          unitPrice,
          priceId: !cover && unitPrice === price?.unitPrice ? price.id : null,
          packageEnrollmentId: cover?.enrollmentId ?? null,
          serviceDate,
          capturedBy: actor.userId,
        })
        .returning();
      const row = found(created, "Charge");
      await this.audit.record(tx, actor, {
        action: "billing.charge.capture",
        resourceType: "billing_charge",
        resourceId: row.id,
        patientId: row.patientId,
        reason: input.priceOverrideReason,
        metadata: {
          source: "manual",
          serviceCode: service.code,
          unitPrice,
          listedPrice: price?.unitPrice ?? null,
          quantity: row.quantity,
          packageEnrollmentId: row.packageEnrollmentId,
        },
      });
      await this.events.record(tx, chargeEvent(row));
      return chargeView(row);
    });
  }

  async cancel(actor: Actor, chargeId: string, input: z.infer<typeof cancelChargeSchema>) {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, chargeId);
      assertVersion(current.version, input.version, "Charge");
      if (current.status !== "pending") {
        throw new BusinessRuleError(
          current.status === "invoiced" ? "The charge is on an invoice; remove it from the draft or void the invoice" : "The charge is already cancelled",
          "charge_not_pending",
        );
      }
      const [updated] = await tx
        .update(billingCharge)
        .set({ status: "cancelled", cancelReason: input.reason, updatedAt: new Date(), version: sql`${billingCharge.version} + 1` })
        .where(eq(billingCharge.id, chargeId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "billing.charge.cancel",
        resourceType: "billing_charge",
        resourceId: chargeId,
        patientId: current.patientId,
        reason: input.reason,
      });
      return chargeView(found(updated, "Charge"));
    });
  }

  async lock(tx: DbExecutor, organizationId: string, chargeId: string) {
    const [row] = await tx
      .select()
      .from(billingCharge)
      .where(and(eq(billingCharge.organizationId, organizationId), eq(billingCharge.id, chargeId)))
      .for("update");
    return found(row, "Charge");
  }

  /** Pending charges of a patient at a facility, locked for putting on an invoice. */
  async lockPending(tx: DbExecutor, organizationId: string, facilityId: string, patientId: string, chargeIds?: string[]) {
    const filters: SQL[] = [
      eq(billingCharge.organizationId, organizationId),
      eq(billingCharge.facilityId, facilityId),
      eq(billingCharge.patientId, patientId),
      eq(billingCharge.status, "pending"),
    ];
    if (chargeIds) filters.push(inArray(billingCharge.id, chargeIds));
    return tx
      .select()
      .from(billingCharge)
      .where(and(...filters))
      .orderBy(billingCharge.serviceDate, billingCharge.capturedAt)
      .for("update");
  }
}

function coveredDescription(description: string, packageName: string): string {
  return `${description} (covered by ${packageName})`.slice(0, 200);
}

export function chargeView(row: BillingChargeRecord) {
  return { ...publicView(row), amount: row.unitPrice * row.quantity };
}

function chargeEvent(row: BillingChargeRecord) {
  return {
    type: "ChargeCaptured",
    organizationId: row.organizationId,
    aggregateType: "billing_charge",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: { serviceId: row.serviceId, sourceType: row.sourceType, amount: row.unitPrice * row.quantity },
  };
}
