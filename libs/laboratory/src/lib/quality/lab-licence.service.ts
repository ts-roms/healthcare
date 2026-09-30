import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, localDate, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { recordLicenceSchema } from "./quality-management.dto";
import { licenceState } from "./quality-management.rules";
import { labFacilityLicence, type LabFacilityLicenceRecord } from "./quality-management.schema";

/**
 * The facility's laboratory licence as issued, recorded by staff (docs/domains/laboratory-quality.md, "Licence"): the
 * number, classification and issuing office as written on it, its validity and the head of the laboratory. The
 * platform checks dates only (reminder window chosen by the organization); licensing rules are not encoded and the
 * licence is not verified with DOH (compliance dependency). Append-only: a renewal is a new record.
 */
@Injectable()
export class LabLicenceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  /** The current licence (latest recorded), its state today and the history, newest first. */
  async overview(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const [rows, facility] = await Promise.all([
      this.db
        .select()
        .from(labFacilityLicence)
        .where(and(eq(labFacilityLicence.organizationId, actor.organizationId), eq(labFacilityLicence.facilityId, facilityId)))
        .orderBy(desc(labFacilityLicence.recordedAt)),
      this.organizations.getFacility(actor.organizationId, facilityId),
    ]);
    const today = localDate(new Date(), facility.timezone);
    const current = rows[0] ?? null;
    return { facilityId, today, state: licenceState(current, today), current: current ? view(current) : null, history: rows.map(view) };
  }

  async record(actor: Actor, input: z.infer<typeof recordLicenceSchema>) {
    const facilityId = requireFacilityId(actor);
    if (input.validUntil < input.validFrom) throw new BusinessRuleError("The licence ends before it starts", "invalid_validity");
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(labFacilityLicence)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          licenceNumber: input.licenceNumber,
          classification: input.classification ?? null,
          issuedBy: input.issuedBy ?? null,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          headName: input.headName ?? null,
          headLicenceNumber: input.headLicenceNumber ?? null,
          reminderDays: input.reminderDays,
          recordedBy: actor.userId,
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: "lab.licence.record",
        resourceType: "lab_facility_licence",
        resourceId: row!.id,
        metadata: { licenceNumber: input.licenceNumber, validFrom: input.validFrom, validUntil: input.validUntil },
      });
    });
    return this.overview(actor);
  }

  /** The state of the current licence at the facility (for the quality summary). */
  async state(actor: Actor, today: string) {
    const [row] = await this.db
      .select()
      .from(labFacilityLicence)
      .where(and(eq(labFacilityLicence.organizationId, actor.organizationId), eq(labFacilityLicence.facilityId, requireFacilityId(actor))))
      .orderBy(desc(labFacilityLicence.recordedAt))
      .limit(1);
    return { state: licenceState(row ?? null, today), validUntil: row?.validUntil ?? null };
  }
}

function view(row: LabFacilityLicenceRecord) {
  const { organizationId: _o, ...rest } = row;
  return rest;
}
