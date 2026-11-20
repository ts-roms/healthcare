import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, desc, eq, lte } from "drizzle-orm";
import { COMPLIANCE_AREAS, complianceReview } from "../compliance/compliance.schema";
import type { ComplianceAreaState } from "./compliance-gaps.rules";

/** What `admin.compliance-gaps` reads: each compliance area's latest review recorded by a moment. */
@Injectable()
export class OrganizationAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async complianceAreas(organizationId: string, asOf: Date): Promise<ComplianceAreaState[]> {
    const rows = await this.db
      .select({ area: complianceReview.area, reviewedOn: complianceReview.reviewedOn, outcome: complianceReview.outcome })
      .from(complianceReview)
      .where(and(eq(complianceReview.organizationId, organizationId), lte(complianceReview.recordedAt, asOf)))
      .orderBy(desc(complianceReview.reviewedOn), desc(complianceReview.recordedAt));
    return COMPLIANCE_AREAS.map((area) => {
      const last = rows.find((r) => r.area === area);
      return { area, last: last ? { reviewedOn: last.reviewedOn, outcome: last.outcome } : null };
    });
  }
}
