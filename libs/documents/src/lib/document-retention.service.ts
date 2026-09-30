import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, ConflictError, DATABASE, type Database } from "@healthcare/core";
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import type { retentionPolicySchema } from "./document.dto";
import { type DocumentCategory, document, documentRetentionPolicy, type DocumentRetentionPolicyRecord } from "./document.schema";

const REVIEW_LIST_LIMIT = 200;

/**
 * Document retention (docs/architecture/compliance-configuration.md, "Data Privacy Act"): the organization sets a
 * retention period per document category from its own retention schedule (the platform suggests none), and reviews
 * the documents older than it. **Nothing is deleted:** a reviewed document may be archived through the documents API
 * with a reason, as any document; disposal of the stored file is the organization's own procedure (compliance
 * dependency). Documents a domain manages itself (laboratory attachments) are left to that domain.
 */
@Injectable()
export class DocumentRetentionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Active policies with how many available documents are past each period, and ended policies (history). */
  async overview(actor: Actor) {
    const policies = await this.db
      .select()
      .from(documentRetentionPolicy)
      .where(eq(documentRetentionPolicy.organizationId, actor.organizationId))
      .orderBy(asc(documentRetentionPolicy.category), asc(documentRetentionPolicy.createdAt));
    const active = policies.filter((p) => p.status === "active");
    const counts = await Promise.all(
      active.map(async (p) => {
        const [row] = await this.db
          .select({ count: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${document.uploadedAt})::text` })
          .from(document)
          .where(this.pastPeriod(actor.organizationId, p));
        return { policyId: p.id, pastPeriod: row?.count ?? 0, oldestUploadedAt: row?.oldest ?? null };
      }),
    );
    await this.audit.recordStandalone(actor, { action: "document.retention.view", resourceType: "organization", resourceId: actor.organizationId });
    return {
      policies: active.map((p) => ({ ...view(p), ...counts.find((c) => c.policyId === p.id)! })),
      ended: policies.filter((p) => p.status === "inactive").map(view),
    };
  }

  /** Sets a category's period: an existing active policy for it is ended (kept as history). */
  async setPolicy(actor: Actor, input: z.infer<typeof retentionPolicySchema>) {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .update(documentRetentionPolicy)
        .set({ status: "inactive", endedBy: actor.userId, endedAt: new Date() })
        .where(
          and(
            eq(documentRetentionPolicy.organizationId, actor.organizationId),
            eq(documentRetentionPolicy.category, input.category),
            eq(documentRetentionPolicy.status, "active"),
          ),
        )
        .returning();
      const [row] = await tx
        .insert(documentRetentionPolicy)
        .values({ organizationId: actor.organizationId, ...input, createdBy: actor.userId })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictError("The policy changed; reload it", undefined, "version_conflict");
      await this.audit.record(tx, actor, {
        action: "document.retention.set",
        resourceType: "document_retention_policy",
        resourceId: row.id,
        changes: { retainYears: { from: current?.retainYears ?? null, to: row.retainYears } },
        metadata: { category: row.category, basisNote: row.basisNote },
      });
    });
    return this.overview(actor);
  }

  /** Ends a category's period: its documents are no longer reviewed. */
  async endPolicy(actor: Actor, category: DocumentCategory) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(documentRetentionPolicy)
        .set({ status: "inactive", endedBy: actor.userId, endedAt: new Date() })
        .where(
          and(
            eq(documentRetentionPolicy.organizationId, actor.organizationId),
            eq(documentRetentionPolicy.category, category),
            eq(documentRetentionPolicy.status, "active"),
          ),
        )
        .returning();
      if (!row) throw new ConflictError("No retention period is set for this category", undefined, "no_policy");
      await this.audit.record(tx, actor, {
        action: "document.retention.end",
        resourceType: "document_retention_policy",
        resourceId: row.id,
        metadata: { category },
      });
    });
    return this.overview(actor);
  }

  /** The available documents of a category past its period, oldest first (metadata only; audited). */
  async review(actor: Actor, category: DocumentCategory) {
    const [policy] = await this.db
      .select()
      .from(documentRetentionPolicy)
      .where(
        and(
          eq(documentRetentionPolicy.organizationId, actor.organizationId),
          eq(documentRetentionPolicy.category, category),
          eq(documentRetentionPolicy.status, "active"),
        ),
      );
    if (!policy) return { policy: null, documents: [], more: false };
    const rows = await this.db
      .select({
        id: document.id,
        patientId: document.patientId,
        facilityId: document.facilityId,
        title: document.title,
        fileName: document.fileName,
        source: document.source,
        uploadedAt: document.uploadedAt,
      })
      .from(document)
      .where(this.pastPeriod(actor.organizationId, policy))
      .orderBy(asc(document.uploadedAt), asc(document.id))
      .limit(REVIEW_LIST_LIMIT + 1);
    await this.audit.recordStandalone(actor, {
      action: "document.retention.review",
      resourceType: "document_retention_policy",
      resourceId: policy.id,
      metadata: { category, listed: Math.min(rows.length, REVIEW_LIST_LIMIT) },
    });
    return { policy: view(policy), documents: rows.slice(0, REVIEW_LIST_LIMIT), more: rows.length > REVIEW_LIST_LIMIT };
  }

  private pastPeriod(organizationId: string, policy: DocumentRetentionPolicyRecord) {
    return and(
      eq(document.organizationId, organizationId),
      eq(document.category, policy.category),
      eq(document.status, "available"),
      isNull(document.managedBy),
      lt(document.uploadedAt, sql`now() - make_interval(years => ${policy.retainYears})`),
    );
  }
}

function view(p: DocumentRetentionPolicyRecord) {
  const { organizationId: _o, ...rest } = p;
  return rest;
}
