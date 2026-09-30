import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, localDate } from "@healthcare/core";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { recordComplianceReviewSchema } from "./compliance.dto";
import { COMPLIANCE_AREAS, type ComplianceArea, complianceReview, type ComplianceReviewRecord } from "./compliance.schema";

export type ComplianceReviewView = Omit<ComplianceReviewRecord, "organizationId">;

/**
 * Compliance reviews (docs/architecture/compliance-configuration.md): the platform encodes no government rule; each
 * area's configuration is the organization's own, and this records who checked it against current official
 * requirements (its adviser), when, against what, and with what outcome. Append-only; nothing here makes the platform
 * compliant — it keeps the organization's evidence that its configuration was reviewed.
 */
@Injectable()
export class ComplianceReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Every area with its latest review (null: never reviewed) and the full history, newest first. */
  async overview(actor: Actor) {
    const rows = await this.db
      .select()
      .from(complianceReview)
      .where(eq(complianceReview.organizationId, actor.organizationId))
      .orderBy(desc(complianceReview.reviewedOn), desc(complianceReview.recordedAt));
    const views = rows.map(view);
    return {
      areas: COMPLIANCE_AREAS.map((area) => ({ area, latest: views.find((r) => r.area === area) ?? null })),
      history: views,
    };
  }

  async record(actor: Actor, input: z.infer<typeof recordComplianceReviewSchema>): Promise<ComplianceReviewView> {
    // A review cannot be dated in the future (Manila date; reviews belong to the organization, not a facility).
    if (input.reviewedOn > localDate(new Date(), "Asia/Manila")) throw new BusinessRuleError("The review date is in the future", "reviewed_in_future");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(complianceReview)
        .values({
          organizationId: actor.organizationId,
          area: input.area,
          outcome: input.outcome,
          reviewerName: input.reviewerName,
          reviewerRole: input.reviewerRole,
          reference: input.reference,
          reviewedOn: input.reviewedOn,
          note: input.note || null,
          recordedBy: actor.userId,
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: "compliance.review.record",
        resourceType: "compliance_review",
        resourceId: row!.id,
        metadata: { area: input.area, outcome: input.outcome, reviewedOn: input.reviewedOn },
      });
      return view(row!);
    });
  }

  /** The latest review of one area (for screens that show whether their configuration was validated). */
  async latest(organizationId: string, area: ComplianceArea): Promise<ComplianceReviewView | null> {
    const [row] = await this.db
      .select()
      .from(complianceReview)
      .where(and(eq(complianceReview.organizationId, organizationId), eq(complianceReview.area, area)))
      .orderBy(desc(complianceReview.reviewedOn), desc(complianceReview.recordedAt))
      .limit(1);
    return row ? view(row) : null;
  }
}

function view(row: ComplianceReviewRecord): ComplianceReviewView {
  const { organizationId: _o, ...rest } = row;
  return rest;
}
