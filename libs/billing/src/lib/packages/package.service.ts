import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  NotFoundError,
  PgErrorCode,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { cancelEnrollmentSchema, createPackageSchema, sellPackageSchema } from "../billing.dto";
import { packageCovers, packageEndsOn } from "../billing.rules";
import {
  billingCharge,
  billingPackageEnrollment,
  type BillingPackageEnrollmentRecord,
  billingPackageItem,
  billingService,
  billingServicePrice,
} from "../billing.schema";
import { assertVersion, found, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";

/**
 * Packages (e.g. an annual physical examination): a billable service of its
 * own — with versioned prices like any service — and the services it
 * includes. Contents are fixed once created (a changed package is a new one;
 * deactivate the old), so what a patient bought never changes under them.
 *
 * Selling a package at a facility records an enrollment and a charge for the
 * package at its price. While the enrollment is active and in its dates,
 * charges at that facility for included services — captured from clinical
 * work or added by staff — are covered: charged at zero and counted against
 * what is left, which is derived from the charges (cancelling a covered
 * charge gives its units back). An enrollment is cancelled, with a reason,
 * only while nothing was used; a package already on an invoice is refunded
 * through that invoice (credit note).
 */
@Injectable()
export class PackageService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: BillingCatalogService,
    private readonly organizations: OrganizationService,
  ) {}

  /** Packages with their contents and price on `onDate`. */
  async list(organizationId: string, onDate: string) {
    const packages = await this.db
      .select()
      .from(billingService)
      .where(and(eq(billingService.organizationId, organizationId), eq(billingService.isPackage, true)))
      .orderBy(asc(billingService.name));
    if (packages.length === 0) return [];
    const items = await this.db
      .select({ item: billingPackageItem, name: billingService.name, code: billingService.code })
      .from(billingPackageItem)
      .innerJoin(billingService, eq(billingService.id, billingPackageItem.serviceId))
      .where(
        inArray(
          billingPackageItem.packageServiceId,
          packages.map((p) => p.id),
        ),
      );
    return Promise.all(
      packages.map(async (p) => ({
        ...publicView(p),
        currentPrice: (await this.catalog.priceOn(this.db, p.id, onDate))?.unitPrice ?? null,
        items: items
          .filter((i) => i.item.packageServiceId === p.id)
          .map((i) => ({ serviceId: i.item.serviceId, serviceCode: i.code, serviceName: i.name, quantity: i.item.quantity })),
      })),
    );
  }

  async create(actor: Actor, input: z.infer<typeof createPackageSchema>) {
    if (new Set(input.items.map((i) => i.serviceId)).size !== input.items.length) {
      throw new BusinessRuleError("List each included service once, with its quantity", "package_duplicate_service");
    }
    try {
      return await this.db.transaction(async (tx) => {
        const included = await tx
          .select()
          .from(billingService)
          .where(
            and(
              eq(billingService.organizationId, actor.organizationId),
              inArray(
                billingService.id,
                input.items.map((i) => i.serviceId),
              ),
            ),
          );
        if (included.length !== input.items.length) throw new NotFoundError("Service");
        if (included.some((s) => s.isPackage)) throw new BusinessRuleError("A package cannot include another package", "package_in_package");
        const [created] = await tx
          .insert(billingService)
          .values({
            organizationId: actor.organizationId,
            code: input.code,
            name: input.name,
            category: input.category,
            isPackage: true,
            packageValidityDays: input.validityDays ?? null,
          })
          .returning();
        const pkg = found(created, "Package");
        await tx.insert(billingServicePrice).values({
          organizationId: actor.organizationId,
          serviceId: pkg.id,
          unitPrice: input.unitPrice,
          effectiveFrom: input.effectiveFrom,
          createdBy: actor.userId,
        });
        await tx
          .insert(billingPackageItem)
          .values(input.items.map((i) => ({ organizationId: actor.organizationId, packageServiceId: pkg.id, serviceId: i.serviceId, quantity: i.quantity })));
        await this.audit.record(tx, actor, {
          action: "billing.package.create",
          resourceType: "billing_service",
          resourceId: pkg.id,
          metadata: { code: pkg.code, unitPrice: input.unitPrice, validityDays: input.validityDays ?? null, items: input.items },
        });
        return publicView(pkg);
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation)
        throw new ConflictError("A service with this code already exists", undefined, "service_exists");
      throw error;
    }
  }

  /** Sells a package to a patient at the selected facility: an enrollment and a charge for the package at today's price. */
  async sell(actor: Actor, patientId: string, input: z.infer<typeof sellPackageSchema>) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const today = localDate(new Date(), facility.timezone);
    const id = await this.db.transaction(async (tx) => {
      const pkg = await this.catalog.requireService(tx, actor.organizationId, input.packageServiceId);
      if (!pkg.isPackage) throw new BusinessRuleError("This service is not a package", "not_a_package");
      if (pkg.status !== "active") throw new BusinessRuleError("This package is no longer sold", "service_inactive");
      const price = await this.catalog.priceOn(tx, pkg.id, today);
      if (!price) throw new BusinessRuleError("This package has no price for today", "price_required");
      const [created] = await tx
        .insert(billingPackageEnrollment)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId,
          packageServiceId: pkg.id,
          startsOn: today,
          endsOn: packageEndsOn(today, pkg.packageValidityDays),
          soldBy: actor.userId,
        })
        .returning();
      const enrollment = found(created, "Package enrollment");
      const [charge] = await tx
        .insert(billingCharge)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId,
          serviceId: pkg.id,
          sourceType: "package",
          sourceId: enrollment.id,
          description: pkg.name,
          unitPrice: price.unitPrice,
          priceId: price.id,
          serviceDate: today,
          capturedBy: actor.userId,
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: "billing.package.sell",
        resourceType: "billing_package_enrollment",
        resourceId: enrollment.id,
        patientId,
        metadata: { packageCode: pkg.code, unitPrice: price.unitPrice, endsOn: enrollment.endsOn, chargeId: charge?.id },
      });
      await this.events.record(tx, {
        type: "ChargeCaptured",
        organizationId: actor.organizationId,
        aggregateType: "billing_charge",
        aggregateId: found(charge, "Charge").id,
        facilityId,
        patientId,
        payload: { serviceId: pkg.id, sourceType: "package", amount: price.unitPrice },
      });
      return enrollment.id;
    });
    return (await this.enrollmentsOf(this.db, actor.organizationId, patientId, facilityId, id))[0];
  }

  /** The patient's packages at the selected facility, with what is left of each included service. */
  async enrollments(actor: Actor, patientId: string) {
    const facilityId = requireFacilityId(actor);
    const rows = await this.enrollmentsOf(this.db, actor.organizationId, patientId, facilityId);
    await this.audit.recordStandalone(actor, {
      action: "billing.package.list",
      resourceType: "billing_package_enrollment",
      patientId,
      metadata: { facilityId, count: rows.length },
    });
    return rows;
  }

  async cancel(actor: Actor, enrollmentId: string, input: z.infer<typeof cancelEnrollmentSchema>) {
    const facilityId = requireFacilityId(actor);
    await this.db.transaction(async (tx) => {
      const enrollment = await this.lock(tx, actor.organizationId, enrollmentId);
      if (enrollment.facilityId !== facilityId) throw new NotFoundError("Package enrollment");
      assertVersion(enrollment.version, input.version, "Package enrollment");
      if (enrollment.status !== "active") throw new BusinessRuleError("The package is already cancelled", "package_not_active");
      const [used] = await tx
        .select({ id: billingCharge.id })
        .from(billingCharge)
        .where(and(eq(billingCharge.packageEnrollmentId, enrollmentId), ne(billingCharge.status, "cancelled")))
        .limit(1);
      if (used) throw new BusinessRuleError("The package was already used; it can no longer be cancelled", "package_in_use");
      await tx
        .update(billingPackageEnrollment)
        .set({ status: "cancelled", cancelReason: input.reason, updatedAt: new Date(), version: sql`${billingPackageEnrollment.version} + 1` })
        .where(eq(billingPackageEnrollment.id, enrollmentId));
      // The sale's charge, if not yet invoiced, is cancelled with it; an invoiced one is credited on its invoice.
      const cancelled = await tx
        .update(billingCharge)
        .set({ status: "cancelled", cancelReason: `Package cancelled: ${input.reason}`, updatedAt: new Date(), version: sql`${billingCharge.version} + 1` })
        .where(and(eq(billingCharge.sourceType, "package"), eq(billingCharge.sourceId, enrollmentId), eq(billingCharge.status, "pending")))
        .returning({ id: billingCharge.id });
      await this.audit.record(tx, actor, {
        action: "billing.package.cancel",
        resourceType: "billing_package_enrollment",
        resourceId: enrollmentId,
        patientId: enrollment.patientId,
        reason: input.reason,
        metadata: { saleChargeCancelled: cancelled.length > 0 },
      });
    });
    return (await this.enrollmentsOf(this.db, actor.organizationId, "", facilityId, enrollmentId))[0];
  }

  /**
   * The enrollment that covers `quantity` of a service for a patient at a facility on a date, if one does (locked
   * for the rest of the transaction). Called by charge capture and manual charges.
   */
  async coverFor(
    tx: DbExecutor,
    input: { organizationId: string; facilityId: string; patientId: string; serviceId: string; quantity: number; onDate: string },
  ) {
    const candidates = await tx
      .select({ enrollment: billingPackageEnrollment, included: billingPackageItem.quantity, packageName: billingService.name })
      .from(billingPackageEnrollment)
      .innerJoin(
        billingPackageItem,
        and(eq(billingPackageItem.packageServiceId, billingPackageEnrollment.packageServiceId), eq(billingPackageItem.serviceId, input.serviceId)),
      )
      .innerJoin(billingService, eq(billingService.id, billingPackageEnrollment.packageServiceId))
      .where(
        and(
          eq(billingPackageEnrollment.organizationId, input.organizationId),
          eq(billingPackageEnrollment.facilityId, input.facilityId),
          eq(billingPackageEnrollment.patientId, input.patientId),
          eq(billingPackageEnrollment.status, "active"),
        ),
      )
      // The one ending soonest first, so nothing expires unused while a later one is drawn down.
      .orderBy(sql`${billingPackageEnrollment.endsOn} ASC NULLS LAST`, asc(billingPackageEnrollment.createdAt))
      .for("update", { of: billingPackageEnrollment });
    for (const c of candidates) {
      const used = await this.used(tx, c.enrollment.id, input.serviceId);
      if (packageCovers(c.enrollment, c.included, used, input.quantity, input.onDate)) {
        return { enrollmentId: c.enrollment.id, packageName: c.packageName };
      }
    }
    return null;
  }

  // ---- internals ----------------------------------------------------------------------------

  private async used(tx: DbExecutor, enrollmentId: string, serviceId: string) {
    const [row] = await tx
      .select({ used: sql<number>`coalesce(sum(${billingCharge.quantity}), 0)::int` })
      .from(billingCharge)
      .where(and(eq(billingCharge.packageEnrollmentId, enrollmentId), eq(billingCharge.serviceId, serviceId), ne(billingCharge.status, "cancelled")));
    return Number(row?.used ?? 0);
  }

  private async lock(tx: DbExecutor, organizationId: string, enrollmentId: string): Promise<BillingPackageEnrollmentRecord> {
    const [row] = await tx
      .select()
      .from(billingPackageEnrollment)
      .where(and(eq(billingPackageEnrollment.organizationId, organizationId), eq(billingPackageEnrollment.id, enrollmentId)))
      .for("update");
    return found(row, "Package enrollment");
  }

  /** Enrollments at a facility (of a patient, or one by id) with their contents and what is left. */
  private async enrollmentsOf(executor: DbExecutor, organizationId: string, patientId: string, facilityId: string, enrollmentId?: string) {
    const rows = await executor
      .select({ enrollment: billingPackageEnrollment, packageName: billingService.name, packageCode: billingService.code })
      .from(billingPackageEnrollment)
      .innerJoin(billingService, eq(billingService.id, billingPackageEnrollment.packageServiceId))
      .where(
        and(
          eq(billingPackageEnrollment.organizationId, organizationId),
          eq(billingPackageEnrollment.facilityId, facilityId),
          enrollmentId ? eq(billingPackageEnrollment.id, enrollmentId) : eq(billingPackageEnrollment.patientId, patientId),
        ),
      )
      .orderBy(desc(billingPackageEnrollment.createdAt));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.enrollment.id);
    const [items, usage, sales] = await Promise.all([
      executor
        .select({ item: billingPackageItem, name: billingService.name })
        .from(billingPackageItem)
        .innerJoin(billingService, eq(billingService.id, billingPackageItem.serviceId))
        .where(
          inArray(
            billingPackageItem.packageServiceId,
            rows.map((r) => r.enrollment.packageServiceId),
          ),
        ),
      executor
        .select({ enrollmentId: billingCharge.packageEnrollmentId, serviceId: billingCharge.serviceId, used: sql<number>`sum(${billingCharge.quantity})::int` })
        .from(billingCharge)
        .where(and(inArray(billingCharge.packageEnrollmentId, ids), ne(billingCharge.status, "cancelled")))
        .groupBy(billingCharge.packageEnrollmentId, billingCharge.serviceId),
      executor
        .select({ sourceId: billingCharge.sourceId, id: billingCharge.id, status: billingCharge.status, invoiceId: billingCharge.invoiceId })
        .from(billingCharge)
        .where(and(eq(billingCharge.sourceType, "package"), inArray(billingCharge.sourceId, ids))),
    ]);
    return rows.map(({ enrollment, packageName, packageCode }) => ({
      ...publicView(enrollment),
      packageName,
      packageCode,
      saleCharge: sales.find((s) => s.sourceId === enrollment.id) ?? null,
      items: items
        .filter((i) => i.item.packageServiceId === enrollment.packageServiceId)
        .map((i) => {
          const used = Number(usage.find((u) => u.enrollmentId === enrollment.id && u.serviceId === i.item.serviceId)?.used ?? 0);
          return { serviceId: i.item.serviceId, serviceName: i.name, included: i.item.quantity, used, left: i.item.quantity - used };
        }),
    }));
  }
}
