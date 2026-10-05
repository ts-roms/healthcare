import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, localDate } from "@healthcare/core";
import { appUser } from "@healthcare/auth";
import { and, count, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { patientMfaPolicySchema } from "../portal/portal.dto";
import { patientMfaPolicy, patientPortalAccount } from "../portal/portal.schema";
import { PATIENT_MFA_MIN_NOTICE_DAYS, patientMfaEnrollmentRequired } from "./portal-security.rules";

export interface PatientMfaPolicyView {
  required: boolean;
  /** The local date from which patients without it can only set it up; null = at once. */
  requiredFrom: string | null;
  version: number;
  updatedAt: Date | null;
  updatedBy: { id: string; displayName: string } | null;
  /** Active MyHealth accounts, and how many have two-step verification on. */
  accounts: { active: number; withMfa: number; withoutMfa: number };
}

/** What the policy means for one account (`GET /portal/me`, the guard). */
export interface OwnPatientMfaPolicy {
  required: boolean;
  requiredFrom: string | null;
  /** The patient can only set two-step verification up until it is on. */
  enrollmentRequired: boolean;
}

const CACHE_MS = 30_000;
/** Policy dates are Philippine calendar days (the platform's local day; CLAUDE.md §36). */
const POLICY_TIME_ZONE = "Asia/Manila";

/**
 * The organization's two-step verification requirement for patients (migration 0100). Mirrors the staff policy
 * (`MfaPolicyService`): requiring it never locks anyone out, and the organization chooses a start date at least
 * {@link PATIENT_MFA_MIN_NOTICE_DAYS} days ahead so patients see a notice first.
 */
@Injectable()
export class PortalMfaPolicyService {
  private readonly cache = new Map<string, { at: number; policy: { required: boolean; requiredFrom: string | null } | null }>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** For the account itself: one cached read per organization every 30 s (the guard calls this on every request). */
  async forAccount(organizationId: string, mfaEnabled: boolean, now = new Date()): Promise<OwnPatientMfaPolicy> {
    const policy = await this.policyOf(organizationId, now);
    return {
      required: policy?.required ?? false,
      requiredFrom: policy?.requiredFrom ?? null,
      enrollmentRequired: patientMfaEnrollmentRequired(policy, mfaEnabled, localDate(now, POLICY_TIME_ZONE)),
    };
  }

  async view(organizationId: string): Promise<PatientMfaPolicyView> {
    const [policy] = await this.db
      .select({ policy: patientMfaPolicy, updatedByName: appUser.displayName })
      .from(patientMfaPolicy)
      .innerJoin(appUser, eq(appUser.id, patientMfaPolicy.updatedBy))
      .where(eq(patientMfaPolicy.organizationId, organizationId));
    const [counts] = await this.db
      .select({ active: count(), withMfa: count(sql`CASE WHEN ${patientPortalAccount.mfaEnabled} THEN 1 END`) })
      .from(patientPortalAccount)
      .where(and(eq(patientPortalAccount.organizationId, organizationId), eq(patientPortalAccount.status, "active")));
    const active = counts?.active ?? 0;
    const withMfa = counts?.withMfa ?? 0;
    return {
      required: policy?.policy.required ?? false,
      requiredFrom: policy?.policy.requiredFrom ?? null,
      version: policy?.policy.version ?? 0,
      updatedAt: policy?.policy.updatedAt ?? null,
      updatedBy: policy ? { id: policy.policy.updatedBy, displayName: policy.updatedByName } : null,
      accounts: { active, withMfa, withoutMfa: active - withMfa },
    };
  }

  async setPolicy(actor: Actor, input: z.infer<typeof patientMfaPolicySchema>): Promise<PatientMfaPolicyView> {
    const requiredFrom = input.required ? (input.requiredFrom ?? null) : null;
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(patientMfaPolicy).where(eq(patientMfaPolicy.organizationId, actor.organizationId)).for("update");
      if ((current?.version ?? 0) !== input.version) {
        throw new ConflictError("The policy was changed by someone else; reload and try again", undefined, "version_conflict");
      }
      // Turning the requirement on needs notice: at least a week from today, unless it is already required.
      if (input.required && !current?.required) {
        const earliest = localDate(new Date(Date.now() + PATIENT_MFA_MIN_NOTICE_DAYS * 86_400_000), POLICY_TIME_ZONE);
        if (!requiredFrom || requiredFrom < earliest) {
          throw new BusinessRuleError(`Give patients notice: choose a start date on or after ${earliest}`, "notice_required", { earliest });
        }
      }
      const before = { required: current?.required ?? false, requiredFrom: current?.requiredFrom ?? null };
      if (current) {
        await tx
          .update(patientMfaPolicy)
          .set({ required: input.required, requiredFrom, updatedBy: actor.userId, updatedAt: new Date(), version: sql`${patientMfaPolicy.version} + 1` })
          .where(eq(patientMfaPolicy.organizationId, actor.organizationId));
      } else {
        await tx.insert(patientMfaPolicy).values({ organizationId: actor.organizationId, required: input.required, requiredFrom, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: "portal.mfa-policy.update",
        resourceType: "organization",
        resourceId: actor.organizationId,
        reason: input.reason,
        changes: { required: { from: before.required, to: input.required }, requiredFrom: { from: before.requiredFrom, to: requiredFrom } },
      });
    });
    this.cache.delete(actor.organizationId);
    return this.view(actor.organizationId);
  }

  private async policyOf(organizationId: string, now: Date): Promise<{ required: boolean; requiredFrom: string | null } | null> {
    const cached = this.cache.get(organizationId);
    if (cached && now.getTime() - cached.at < CACHE_MS) return cached.policy;
    const [row] = await this.db
      .select({ required: patientMfaPolicy.required, requiredFrom: patientMfaPolicy.requiredFrom })
      .from(patientMfaPolicy)
      .where(eq(patientMfaPolicy.organizationId, organizationId));
    const policy = row ?? null;
    this.cache.set(organizationId, { at: now.getTime(), policy });
    return policy;
  }
}
