import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, VersionConflictError } from "@healthcare/core";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { accreditationSchema } from "./philhealth.dto";
import { type AccreditationRecord, philhealthFacilityAccreditation } from "./philhealth.schema";

/** Each facility's PhilHealth accreditation number, as recorded by staff (not verified with PhilHealth). */
@Injectable()
export class PhilHealthSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async accreditation(organizationId: string, facilityId: string): Promise<AccreditationRecord | null> {
    const [row] = await this.db
      .select()
      .from(philhealthFacilityAccreditation)
      .where(and(eq(philhealthFacilityAccreditation.organizationId, organizationId), eq(philhealthFacilityAccreditation.facilityId, facilityId)));
    return row ?? null;
  }

  async recordAccreditation(actor: Actor, facilityId: string, input: z.infer<typeof accreditationSchema>) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(philhealthFacilityAccreditation)
        .where(and(eq(philhealthFacilityAccreditation.organizationId, actor.organizationId), eq(philhealthFacilityAccreditation.facilityId, facilityId)))
        .for("update");
      const values = {
        accreditationNumber: input.accreditationNumber,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      let saved: AccreditationRecord;
      if (current) {
        if (input.version !== current.version) throw new VersionConflictError("PhilHealth accreditation", input.version ?? 0);
        [saved] = (await tx
          .update(philhealthFacilityAccreditation)
          .set({ ...values, version: current.version + 1 })
          .where(eq(philhealthFacilityAccreditation.id, current.id))
          .returning()) as [AccreditationRecord];
      } else {
        // The facility must belong to the organization (composite foreign key).
        [saved] = (await tx
          .insert(philhealthFacilityAccreditation)
          .values({ organizationId: actor.organizationId, facilityId, ...values })
          .returning()) as [AccreditationRecord];
      }
      await this.audit.record(tx, actor, {
        action: "philhealth.accreditation.record",
        resourceType: "facility",
        resourceId: facilityId,
        changes: {
          accreditationNumber: { from: current?.accreditationNumber ?? null, to: saved.accreditationNumber },
          validFrom: { from: current?.validFrom ?? null, to: saved.validFrom },
          validUntil: { from: current?.validUntil ?? null, to: saved.validUntil },
        },
      });
      return view(saved);
    });
  }
}

export function view({ organizationId: _o, ...row }: AccreditationRecord) {
  return row;
}
