import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  ForbiddenError,
  PgErrorCode,
  VersionConflictError,
} from "@healthcare/core";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { ClinicConfigService } from "../config/clinic-config.service";
import { signatureProblem } from "../procedures/procedure.rules";
import { practitionerSignature, practitionerSignatureSetting } from "./practitioner-signature.schema";
import type { drawPractitionerSignatureSchema, updatePractitionerSignatureSettingSchema } from "./practitioner-signature.dto";

export interface PractitionerSignatureSettingView {
  /** Medical certificates and referral letters print the issuing practitioner's signature when they have drawn one. */
  enabled: boolean;
  /** 0 while the organization has never saved its own. */
  version: number;
}

/** The signed-in member's own signature: only they ever see its strokes. */
export interface MyPractitionerSignatureView {
  /** The member's practitioner record, or null when they are not a practitioner (nothing to sign as). */
  practitioner: { id: string; displayName: string } | null;
  enabled: boolean;
  signature: { id: string; drawnAt: string; strokes: number[][][] } | null;
}

/**
 * A practitioner's own signature on the medical certificates and referral letters they issue (electronic signatures, phase
 * 3, migration 0122). Cosmetic: the issuer's authentication is the control, and nothing here is a cryptographic or legally
 * qualified signature. Drawn once by the practitioner themself (strokes, no image upload); only they set or withdraw it. The
 * organization decides whether documents print it (off by default). The signature in force is recorded on each certificate
 * or referral when it is issued (`forIssue`), so a later change never alters an issued document.
 */
@Injectable()
export class PractitionerSignatureService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly config: ClinicConfigService,
  ) {}

  // ---- the organization's choice -----------------------------------------------------------------------------------

  async settings(organizationId: string, executor: DbExecutor = this.db): Promise<PractitionerSignatureSettingView> {
    const [row] = await executor.select().from(practitionerSignatureSetting).where(eq(practitionerSignatureSetting.organizationId, organizationId));
    return { enabled: row?.enabled ?? false, version: row?.version ?? 0 };
  }

  async updateSettings(actor: Actor, input: z.output<typeof updatePractitionerSignatureSettingSchema>): Promise<PractitionerSignatureSettingView> {
    await this.db.transaction(async (tx) => {
      if (input.version === 0) {
        try {
          await tx.insert(practitionerSignatureSetting).values({ organizationId: actor.organizationId, enabled: input.enabled, updatedBy: actor.userId! });
        } catch (error) {
          if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new VersionConflictError("Signature setting", input.version);
          throw error;
        }
      } else {
        const updated = await tx
          .update(practitionerSignatureSetting)
          .set({ enabled: input.enabled, updatedBy: actor.userId!, updatedAt: new Date(), version: input.version + 1 })
          .where(and(eq(practitionerSignatureSetting.organizationId, actor.organizationId), eq(practitionerSignatureSetting.version, input.version)))
          .returning({ version: practitionerSignatureSetting.version });
        if (!updated.length) throw new VersionConflictError("Signature setting", input.version);
      }
      await this.audit.record(tx, actor, {
        action: "clinic.practitioner-signature-settings.update",
        resourceType: "practitioner_signature_setting",
        resourceId: actor.organizationId,
        metadata: { enabled: input.enabled },
      });
    });
    return this.settings(actor.organizationId);
  }

  // ---- the member's own signature ----------------------------------------------------------------------------------

  async mine(actor: Actor): Promise<MyPractitionerSignatureView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId!);
    const setting = await this.settings(actor.organizationId);
    if (!clinician) return { practitioner: null, enabled: setting.enabled, signature: null };
    const [row] = await this.db
      .select()
      .from(practitionerSignature)
      .where(
        and(
          eq(practitionerSignature.organizationId, actor.organizationId),
          eq(practitionerSignature.practitionerId, clinician.id),
          isNull(practitionerSignature.withdrawnAt),
        ),
      );
    return {
      practitioner: { id: clinician.id, displayName: clinician.displayName },
      enabled: setting.enabled,
      signature: row ? { id: row.id, drawnAt: row.drawnAt.toISOString(), strokes: row.strokes } : null,
    };
  }

  /** Draws the member's signature (replacing the one in force: earlier ones stay for the documents that printed them). */
  async draw(actor: Actor, input: z.output<typeof drawPractitionerSignatureSchema>): Promise<MyPractitionerSignatureView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId!);
    if (!clinician) throw new ForbiddenError("Only a practitioner has a signature to draw");
    const problem = signatureProblem(input.strokes);
    if (problem) throw new BusinessRuleError(problem === "signature_empty" ? "Draw your signature again" : "The signature is too large", problem);
    await this.db.transaction(async (tx) => {
      await tx
        .update(practitionerSignature)
        .set({ withdrawnAt: new Date() })
        .where(
          and(
            eq(practitionerSignature.organizationId, actor.organizationId),
            eq(practitionerSignature.practitionerId, clinician.id),
            isNull(practitionerSignature.withdrawnAt),
          ),
        );
      const [row] = await tx
        .insert(practitionerSignature)
        .values({ organizationId: actor.organizationId, practitionerId: clinician.id, strokes: input.strokes, drawnBy: actor.userId! })
        .returning({ id: practitionerSignature.id });
      await this.audit.record(tx, actor, {
        action: "practitioner.signature-draw",
        resourceType: "practitioner_signature",
        resourceId: row!.id,
        metadata: { practitionerId: clinician.id },
      });
    });
    return this.mine(actor);
  }

  /** Withdraws the signature in force: documents issued from now on print none (issued ones keep theirs). */
  async withdraw(actor: Actor): Promise<MyPractitionerSignatureView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId!);
    if (!clinician) throw new ForbiddenError("Only a practitioner has a signature");
    await this.db.transaction(async (tx) => {
      const withdrawn = await tx
        .update(practitionerSignature)
        .set({ withdrawnAt: new Date() })
        .where(
          and(
            eq(practitionerSignature.organizationId, actor.organizationId),
            eq(practitionerSignature.practitionerId, clinician.id),
            isNull(practitionerSignature.withdrawnAt),
          ),
        )
        .returning({ id: practitionerSignature.id });
      if (!withdrawn.length) throw new BusinessRuleError("There is no signature to withdraw", "no_signature");
      await this.audit.record(tx, actor, {
        action: "practitioner.signature-withdraw",
        resourceType: "practitioner_signature",
        resourceId: withdrawn[0]!.id,
        metadata: { practitionerId: clinician.id },
      });
    });
    return this.mine(actor);
  }

  // ---- for the documents that print it -----------------------------------------------------------------------------

  /** The signature to record on a certificate or letter issued now: the practitioner's one in force, when the organization prints them. */
  async forIssue(executor: DbExecutor, organizationId: string, practitionerId: string): Promise<string | null> {
    if (!(await this.settings(organizationId, executor)).enabled) return null;
    const [row] = await executor
      .select({ id: practitionerSignature.id })
      .from(practitionerSignature)
      .where(
        and(
          eq(practitionerSignature.organizationId, organizationId),
          eq(practitionerSignature.practitionerId, practitionerId),
          isNull(practitionerSignature.withdrawnAt),
        ),
      );
    return row?.id ?? null;
  }

  /** The strokes of a recorded signature, to draw on the stored copy of the document that printed it. */
  async strokesOf(organizationId: string, signatureId: string | null): Promise<number[][][] | null> {
    if (!signatureId) return null;
    const [row] = await this.db
      .select({ strokes: practitionerSignature.strokes })
      .from(practitionerSignature)
      .where(and(eq(practitionerSignature.organizationId, organizationId), eq(practitionerSignature.id, signatureId)));
    return row?.strokes ?? null;
  }
}
