import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, ForbiddenError, NotFoundError } from "@healthcare/core";
import { organization } from "@healthcare/organization";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { appUser, organizationMembership, staffMfaPolicy } from "./auth.schema";
import { clearStaffMfa } from "./mfa-store";
import type { mfaExemptionSchema, mfaPolicySchema, mfaResetSchema } from "./mfa-policy.dto";
import { SessionService } from "./session.service";

export interface MfaPolicyView {
  required: boolean;
  /** Increases with each change; send it back to change the policy (optimistic locking). 0 before it was ever set. */
  version: number;
  updatedAt: Date | null;
  updatedBy: { id: string; displayName: string } | null;
  /** Active members, and how many of them have two-step verification on or are exempt. */
  members: { active: number; withMfa: number; exempt: number; withoutMfa: number };
  /** Active members who still need to set it up (exempt members excluded), for the administrator to follow up. */
  pending: Array<{ id: string; displayName: string; email: string }>;
  exemptions: Array<{ userId: string; displayName: string; email: string; reason: string; exemptedAt: Date; exemptedBy: string | null }>;
}

/** What the signed-in member's organization asks of them (`GET /auth/me`). */
export interface OwnMfaPolicy {
  required: boolean;
  exempt: boolean;
  enrollmentRequired: boolean;
}

/**
 * The organization's two-step verification policy for staff (migration 0086). The policy never locks anyone out: a
 * member without two-step verification signs in as usual and can only set it up (`AccessGuard`), so no one depends on
 * an administrator to get back in except after losing their authenticator (reset).
 */
@Injectable()
export class MfaPolicyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** For the member themselves (actor resolution and `/auth/me`). One query; members with MFA on never need it. */
  async forMember(userId: string, organizationId: string, mfaEnabled: boolean): Promise<OwnMfaPolicy> {
    const [row] = await this.db
      .select({ required: staffMfaPolicy.required, exemptReason: organizationMembership.mfaExemptReason })
      .from(organizationMembership)
      .leftJoin(staffMfaPolicy, eq(staffMfaPolicy.organizationId, organizationMembership.organizationId))
      .where(and(eq(organizationMembership.userId, userId), eq(organizationMembership.organizationId, organizationId)));
    const required = row?.required ?? false;
    const exempt = row?.exemptReason != null;
    return { required, exempt, enrollmentRequired: required && !exempt && !mfaEnabled };
  }

  /** Whether any organization the person is an active, non-exempt member of requires two-step verification. */
  async requiredAnywhere(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ organizationId: organizationMembership.organizationId })
      .from(organizationMembership)
      .innerJoin(staffMfaPolicy, eq(staffMfaPolicy.organizationId, organizationMembership.organizationId))
      .innerJoin(organization, eq(organization.id, organizationMembership.organizationId))
      .where(
        and(
          eq(organizationMembership.userId, userId),
          eq(organizationMembership.status, "active"),
          eq(organization.status, "active"),
          eq(staffMfaPolicy.required, true),
          isNull(organizationMembership.mfaExemptReason),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async view(organizationId: string): Promise<MfaPolicyView> {
    const [policy] = await this.db
      .select({
        required: staffMfaPolicy.required,
        version: staffMfaPolicy.version,
        updatedAt: staffMfaPolicy.updatedAt,
        updatedById: staffMfaPolicy.updatedBy,
        updatedByName: appUser.displayName,
      })
      .from(staffMfaPolicy)
      .innerJoin(appUser, eq(appUser.id, staffMfaPolicy.updatedBy))
      .where(eq(staffMfaPolicy.organizationId, organizationId));
    const members = await this.db
      .select({
        id: appUser.id,
        displayName: appUser.displayName,
        email: appUser.email,
        mfaEnabled: appUser.mfaEnabled,
        exemptReason: organizationMembership.mfaExemptReason,
        exemptedAt: organizationMembership.mfaExemptedAt,
        exemptedBy: organizationMembership.mfaExemptedBy,
      })
      .from(organizationMembership)
      .innerJoin(appUser, eq(appUser.id, organizationMembership.userId))
      .where(and(eq(organizationMembership.organizationId, organizationId), eq(organizationMembership.status, "active"), eq(appUser.status, "active")))
      .orderBy(asc(appUser.displayName));
    const names = new Map(members.map((m) => [m.id, m.displayName]));
    const exemptions = members.flatMap((m) =>
      m.exemptReason != null && m.exemptedAt
        ? [
            {
              userId: m.id,
              displayName: m.displayName,
              email: m.email,
              reason: m.exemptReason,
              exemptedAt: m.exemptedAt,
              exemptedBy: m.exemptedBy ? (names.get(m.exemptedBy) ?? null) : null,
            },
          ]
        : [],
    );
    const pending = members.filter((m) => !m.mfaEnabled && m.exemptReason == null).map(({ id, displayName, email }) => ({ id, displayName, email }));
    const withMfa = members.filter((m) => m.mfaEnabled).length;
    return {
      required: policy?.required ?? false,
      version: policy?.version ?? 0,
      updatedAt: policy?.updatedAt ?? null,
      updatedBy: policy ? { id: policy.updatedById, displayName: policy.updatedByName } : null,
      members: { active: members.length, withMfa, exempt: exemptions.length, withoutMfa: pending.length },
      pending,
      exemptions,
    };
  }

  /**
   * Turns the requirement on or off. Turning it on needs the administrator's own two-step verification first, so the
   * person who sets the rule is never the first one caught by it.
   */
  async setPolicy(actor: Actor, input: z.infer<typeof mfaPolicySchema>): Promise<MfaPolicyView> {
    await this.db.transaction(async (tx) => {
      if (input.required) {
        const [self] = await tx.select({ mfaEnabled: appUser.mfaEnabled }).from(appUser).where(eq(appUser.id, actor.userId));
        if (!self?.mfaEnabled) {
          throw new BusinessRuleError("Turn on two-step verification for your own account before requiring it", "own_mfa_required");
        }
      }
      const [current] = await tx.select().from(staffMfaPolicy).where(eq(staffMfaPolicy.organizationId, actor.organizationId)).for("update");
      if ((current?.version ?? 0) !== input.version) {
        throw new ConflictError("The policy was changed by someone else; reload and try again", undefined, "version_conflict");
      }
      const before = current?.required ?? false;
      if (current) {
        await tx
          .update(staffMfaPolicy)
          .set({ required: input.required, updatedBy: actor.userId, updatedAt: new Date(), version: sql`${staffMfaPolicy.version} + 1` })
          .where(eq(staffMfaPolicy.organizationId, actor.organizationId));
      } else {
        await tx.insert(staffMfaPolicy).values({ organizationId: actor.organizationId, required: input.required, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: "auth.mfa-policy.update",
        resourceType: "organization",
        resourceId: actor.organizationId,
        reason: input.reason,
        changes: { required: { from: before, to: input.required } },
      });
    });
    return this.view(actor.organizationId);
  }

  /** Exempts a member (an integration account that cannot use an authenticator), with a reason. Not oneself. */
  async exempt(actor: Actor, userId: string, input: z.infer<typeof mfaExemptionSchema>): Promise<MfaPolicyView> {
    if (userId === actor.userId) throw new BusinessRuleError("You cannot exempt your own account", "self_modification");
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(organizationMembership)
        .set({ mfaExemptReason: input.reason, mfaExemptedBy: actor.userId, mfaExemptedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(organizationMembership.organizationId, actor.organizationId), eq(organizationMembership.userId, userId)))
        .returning({ id: organizationMembership.id });
      if (!updated) throw new NotFoundError("User");
      await this.audit.record(tx, actor, { action: "auth.mfa-exemption.grant", resourceType: "app_user", resourceId: userId, reason: input.reason });
    });
    return this.view(actor.organizationId);
  }

  async removeExemption(actor: Actor, userId: string): Promise<MfaPolicyView> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(organizationMembership)
        .set({ mfaExemptReason: null, mfaExemptedBy: null, mfaExemptedAt: null, updatedAt: new Date() })
        .where(and(eq(organizationMembership.organizationId, actor.organizationId), eq(organizationMembership.userId, userId)))
        .returning({ id: organizationMembership.id });
      if (!updated) throw new NotFoundError("User");
      await this.audit.record(tx, actor, { action: "auth.mfa-exemption.revoke", resourceType: "app_user", resourceId: userId });
    });
    return this.view(actor.organizationId);
  }

  /**
   * Turns off a member's two-step verification (a lost or replaced phone) and ends their sessions; they set it up again
   * at their next sign-in if the organization requires it. Not oneself (the account page does that with a code), and
   * not an account that also belongs to another organization unless a platform administrator does it — one
   * organization's administrator must not weaken another organization's sign-in.
   */
  async reset(actor: Actor, userId: string, input: z.infer<typeof mfaResetSchema>): Promise<void> {
    if (userId === actor.userId) throw new BusinessRuleError("Use My account to change your own two-step verification", "self_modification");
    await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ mfaEnabled: appUser.mfaEnabled })
        .from(organizationMembership)
        .innerJoin(appUser, eq(appUser.id, organizationMembership.userId))
        .where(and(eq(organizationMembership.organizationId, actor.organizationId), eq(organizationMembership.userId, userId)))
        .for("update", { of: appUser });
      if (!member) throw new NotFoundError("User");
      if (!member.mfaEnabled) throw new BusinessRuleError("This person has not set up two-step verification", "mfa_not_enabled");
      if (!actor.isPlatformAdmin) {
        const [elsewhere] = await tx
          .select({ id: organizationMembership.id })
          .from(organizationMembership)
          .where(
            and(
              eq(organizationMembership.userId, userId),
              ne(organizationMembership.organizationId, actor.organizationId),
              eq(organizationMembership.status, "active"),
            ),
          )
          .limit(1);
        if (elsewhere) {
          throw new ForbiddenError(
            "This account also belongs to another organization; ask a platform administrator to reset it",
            "member_of_other_organizations",
          );
        }
      }
      await clearStaffMfa(tx, userId);
      const revoked = await this.sessions.revokeAllForUser(tx, userId, "mfa_reset");
      await this.audit.record(tx, actor, {
        action: "auth.mfa.reset",
        resourceType: "app_user",
        resourceId: userId,
        reason: input.reason,
        metadata: { sessionsRevoked: revoked },
      });
    });
  }
}
