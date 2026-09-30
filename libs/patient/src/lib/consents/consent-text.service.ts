import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database } from "@healthcare/core";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { type ConsentType, consentText } from "../patient.schema";
import { PATIENT_GRANTABLE_CONSENTS } from "./portal-consent.rules";

export const publishConsentTextSchema = z
  .object({
    consentType: z.enum(["telemedicine", "data_sharing_hmo", "data_sharing_philhealth", "research"]),
    /** False stops offering the consent online (patients then give it at the clinic). */
    offered: z.boolean(),
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
    acknowledgement: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => !v.offered || (v.title && v.body && v.acknowledgement), {
    message: "A wording needs a title, its text and the statement the patient confirms",
    path: ["body"],
  });
export class PublishConsentTextDto extends createZodDto(publishConsentTextSchema) {}

export interface ConsentTextView {
  id: string;
  consentType: ConsentType;
  version: number;
  offered: boolean;
  title: string | null;
  body: string | null;
  acknowledgement: string | null;
  createdAt: string;
}

export interface ConsentTextStatus {
  consentType: ConsentType;
  /** The latest version, or null when none was ever written. */
  current: ConsentTextView | null;
  history: ConsentTextView[];
}

/**
 * The organization's own consent wording for the consents patients may give in MyHealth (migration 0078). The platform
 * ships none: a type is offered online only while the latest version says so. Versions are immutable; "stop offering" is a
 * new version. Nothing here says what a consent legally needs — that is the organization's (and its data protection
 * officer's) to decide.
 */
@Injectable()
export class ConsentTextService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor): Promise<ConsentTextStatus[]> {
    const rows = await this.db.select().from(consentText).where(eq(consentText.organizationId, actor.organizationId)).orderBy(desc(consentText.version));
    return PATIENT_GRANTABLE_CONSENTS.map((consentType) => {
      const history = rows.filter((r) => r.consentType === consentType).map(toView);
      return { consentType, current: history[0] ?? null, history };
    });
  }

  async publish(actor: Actor, input: z.infer<typeof publishConsentTextSchema>): Promise<ConsentTextView> {
    return this.db.transaction(async (tx) => {
      // One writer per consent type, so versions count up without gaps.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`consent-text:${actor.organizationId}:${input.consentType}`}, 0))`);
      const [latest] = await tx
        .select({ version: max(consentText.version) })
        .from(consentText)
        .where(and(eq(consentText.organizationId, actor.organizationId), eq(consentText.consentType, input.consentType)));
      if (!input.offered && !latest?.version) {
        throw new BusinessRuleError("There is no wording to stop offering", "consent_text_not_found");
      }
      const version = (latest?.version ?? 0) + 1;
      const [created] = await tx
        .insert(consentText)
        .values({
          organizationId: actor.organizationId,
          consentType: input.consentType,
          version,
          offered: input.offered,
          title: input.offered ? input.title : null,
          body: input.offered ? input.body : null,
          acknowledgement: input.offered ? input.acknowledgement : null,
          createdBy: actor.userId,
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: input.offered ? "consent.wording-publish" : "consent.wording-withdraw",
        resourceType: "consent_text",
        resourceId: created!.id,
        // The wording itself is the organization's document; the audit keeps which version, not its text.
        metadata: { consentType: input.consentType, version },
      });
      return toView(created!);
    });
  }
}

function toView(row: typeof consentText.$inferSelect): ConsentTextView {
  return {
    id: row.id,
    consentType: row.consentType,
    version: row.version,
    offered: row.offered,
    title: row.title,
    body: row.body,
    acknowledgement: row.acknowledgement,
    createdAt: row.createdAt.toISOString(),
  };
}
