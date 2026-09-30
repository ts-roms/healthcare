import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BadRequestError, BusinessRuleError, DATABASE, type Database, localDate, localDayBounds, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, count, desc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { PRESCRIBING_CONTEXT, type PrescribingContext } from "./ports";
import type { issuedPrescriptionsSchema } from "./prescription.dto";
import { prescription, prescriptionItem } from "./prescription.schema";

/** The longest period one list covers, in the facility's calendar days. */
export const MAX_LIST_DAYS = 92;
/** The most prescriptions one list returns; `truncated` says there were more. */
export const MAX_LIST_ROWS = 300;

export type PrescriptionStatus = "active" | "cancelled" | "superseded";

export interface IssuedPrescriptionRow {
  id: string;
  prescriptionNumber: string;
  status: PrescriptionStatus;
  issuedAt: string;
  encounterId: string;
  patientId: string;
  patient: { patientNumber: string; displayName: string; sex: string; age: number } | null;
  prescriber: { id: string; displayName: string | null };
  /** What was prescribed, one line per item (no dose instructions: open the prescription for those). */
  items: Array<{ genericName: string; strength: string | null; dosageForm: string | null; quantity: number; quantityUnit: string }>;
  replacesPrescriptionId: string | null;
  cancellationReason: string | null;
}

export interface IssuedPrescriptions {
  facilityId: string;
  from: string;
  to: string;
  /** Per status over the whole period and filter (not limited to the rows returned). */
  counts: Record<PrescriptionStatus, number>;
  rows: IssuedPrescriptionRow[];
  truncated: boolean;
}

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * The prescriptions issued at the selected facility (staff `/clinic/prescriptions`): newest first over a period of the
 * facility's own calendar days, optionally by status or only the signed-in practitioner's. Each patient listed is audited
 * (`prescription.list`), as the per-patient list is.
 */
@Injectable()
export class PrescriptionListService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PRESCRIBING_CONTEXT) private readonly context: PrescribingContext,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  async issued(actor: Actor, query: z.infer<typeof issuedPrescriptionsSchema>, now = new Date()): Promise<IssuedPrescriptions> {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const today = localDate(now, facility.timezone);
    const to = query.to ?? today;
    const from = query.from ?? to;
    if (from > to) throw new BadRequestError("The period starts after it ends", "invalid_range");
    if (dayNumber(to) - dayNumber(from) + 1 > MAX_LIST_DAYS) {
      throw new BadRequestError(`Choose a period of at most ${MAX_LIST_DAYS} days`, "range_too_long");
    }
    const filters: SQL[] = [
      eq(prescription.organizationId, actor.organizationId),
      eq(prescription.facilityId, facilityId),
      gte(prescription.issuedAt, localDayBounds(from, facility.timezone).start),
      lt(prescription.issuedAt, localDayBounds(to, facility.timezone).end),
    ];
    if (query.mine === "true") {
      const me = await this.context.prescriber(actor.organizationId, actor.userId);
      if (!me) throw new BusinessRuleError("Your account is not linked to a practitioner, so you have no prescriptions of your own", "not_a_practitioner");
      filters.push(eq(prescription.prescriberPractitionerId, me.id));
    }
    const statusCounts = await this.db
      .select({ status: prescription.status, n: count() })
      .from(prescription)
      .where(and(...filters))
      .groupBy(prescription.status);
    if (query.status) filters.push(eq(prescription.status, query.status));
    const rows = await this.db
      .select()
      .from(prescription)
      .where(and(...filters))
      .orderBy(desc(prescription.issuedAt), desc(prescription.id))
      .limit(MAX_LIST_ROWS + 1);
    const truncated = rows.length > MAX_LIST_ROWS;
    const shown = rows.slice(0, MAX_LIST_ROWS);

    const ids = shown.map((r) => r.id);
    const items = ids.length
      ? await this.db
          .select({
            prescriptionId: prescriptionItem.prescriptionId,
            genericName: prescriptionItem.genericName,
            strength: prescriptionItem.strength,
            dosageForm: prescriptionItem.dosageForm,
            quantity: prescriptionItem.quantity,
            quantityUnit: prescriptionItem.quantityUnit,
          })
          .from(prescriptionItem)
          .where(inArray(prescriptionItem.prescriptionId, ids))
          .orderBy(asc(prescriptionItem.lineNumber))
      : [];
    const patientIds = [...new Set(shown.map((r) => r.patientId))];
    const [patients, prescribers] = await Promise.all([
      this.context.patientBriefs(actor.organizationId, patientIds),
      this.context.practitionerNames(actor.organizationId, [...new Set(shown.map((r) => r.prescriberPractitionerId))]),
    ]);
    for (const patientId of patientIds) {
      await this.audit.recordStandalone(actor, { action: "prescription.list", resourceType: "prescription", patientId, metadata: { view: "facility" } });
    }
    const counts: Record<PrescriptionStatus, number> = { active: 0, cancelled: 0, superseded: 0 };
    for (const c of statusCounts) counts[c.status] = Number(c.n);
    return {
      facilityId,
      from,
      to,
      counts,
      truncated,
      rows: shown.map((r) => ({
        id: r.id,
        prescriptionNumber: r.prescriptionNumber,
        status: r.status,
        issuedAt: r.issuedAt.toISOString(),
        encounterId: r.encounterId,
        patientId: r.patientId,
        patient: patients.get(r.patientId) ?? null,
        prescriber: { id: r.prescriberPractitionerId, displayName: prescribers.get(r.prescriberPractitionerId) ?? null },
        items: items.filter((i) => i.prescriptionId === r.id).map(({ prescriptionId: _p, ...i }) => i),
        replacesPrescriptionId: r.replacesPrescriptionId,
        cancellationReason: r.cancellationReason,
      })),
    };
  }
}
