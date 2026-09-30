import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { appUser } from "@healthcare/auth";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, DomainEventPublisher, NotFoundError } from "@healthcare/core";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { patient } from "../patient.schema";
import { displayName } from "../patient.views";
import { patientAuditContext, PortalAccountService, type PortalPrincipal } from "../portal/portal-account.service";
import { PortalSecurityMailers } from "../portal/portal-security-mailer";
import type { grantProxySchema } from "./proxy.dto";
import { ProxyRefusedError } from "./proxy.errors";
import { grantAllows, grantLive, MAX_DEPENDENTS_PER_GUARDIAN, type ProxyContext } from "./proxy.rules";
import { portalProxyGrant, type PortalProxyGrantRecord } from "./proxy.schema";
import type { ProxyDependentView, ProxyGuardianView, StaffProxyGrantView, StaffProxyOverview } from "./proxy.views";

/**
 * Guardian and dependent access (docs/architecture/portal-app.md, "Guardians and dependents"). A person with their own
 * MyHealth account acts for another person's record only through a grant the clinic made after checking, by its own
 * procedure, who they are and by what right they act. The platform records the basis and what was checked; it decides
 * nothing about age of majority, guardianship or authorization.
 *
 * A request acts for the dependent only while all of these hold: the grant is live (not ended, not past its end date), the
 * guardian's own session and portal consent are in force (the guard has checked), the dependent's record is active, and the
 * dependent's own portal-access consent is in effect (recorded at the clinic — by the guardian for a child). Reading needs
 * the "view" scope; changing anything needs "act". Routes must opt in (`@ProxyAllowed()`); everything about the guardian's
 * own account (sign-in security, notification settings, consents, devices) stays theirs alone.
 */
@Injectable()
export class PortalProxyService {
  private readonly logger = new Logger(PortalProxyService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly accounts: PortalAccountService,
    private readonly mailer: PortalSecurityMailers,
  ) {}

  // ---- the request guard ------------------------------------------------------------------

  /** The principal of a request that acts for a dependent, or a refusal that says no more than "not allowed". */
  async actingFor(principal: PortalPrincipal, dependentPatientId: string, method: string, now = new Date()): Promise<PortalPrincipal> {
    const [grant] = await this.db
      .select()
      .from(portalProxyGrant)
      .where(
        and(
          eq(portalProxyGrant.organizationId, principal.organizationId),
          eq(portalProxyGrant.guardianPatientId, principal.patientId),
          eq(portalProxyGrant.dependentPatientId, dependentPatientId),
          isNull(portalProxyGrant.revokedAt),
        ),
      );
    const [dependent] = grant
      ? await this.db
          .select({ status: patient.status })
          .from(patient)
          .where(and(eq(patient.organizationId, principal.organizationId), eq(patient.id, dependentPatientId)))
      : [];
    if (
      !grant ||
      !grantLive(grant, now) ||
      dependent?.status !== "active" ||
      !(await this.accounts.hasPortalConsent(this.db, principal.organizationId, dependentPatientId))
    ) {
      throw new ProxyRefusedError("You cannot act for this person any more", "proxy_not_allowed");
    }
    if (!grantAllows(grant.scopes, method)) {
      throw new ProxyRefusedError("You can look at this record but not make changes to it", "proxy_view_only");
    }
    const proxy: ProxyContext = { grantId: grant.id, guardianPatientId: principal.patientId, relationship: grant.relationship, scopes: grant.scopes };
    return { ...principal, patientId: dependentPatientId, proxy };
  }

  // ---- the account holder (MyHealth) -------------------------------------------------------

  /** The people this account holder may act for now. */
  async dependentsOf(principal: PortalPrincipal, now = new Date()): Promise<ProxyDependentView[]> {
    const rows = await this.db
      .select({ grant: portalProxyGrant, dependent: patient })
      .from(portalProxyGrant)
      .innerJoin(patient, and(eq(patient.organizationId, portalProxyGrant.organizationId), eq(patient.id, portalProxyGrant.dependentPatientId)))
      .where(
        and(
          eq(portalProxyGrant.organizationId, principal.organizationId),
          eq(portalProxyGrant.guardianPatientId, principal.patientId),
          isNull(portalProxyGrant.revokedAt),
          eq(patient.status, "active"),
        ),
      )
      .orderBy(desc(portalProxyGrant.grantedAt));
    const usable: ProxyDependentView[] = [];
    for (const { grant, dependent } of rows) {
      if (!grantLive(grant, now)) continue;
      if (!(await this.accounts.hasPortalConsent(this.db, principal.organizationId, dependent.id))) continue;
      usable.push({
        grantId: grant.id,
        patientId: dependent.id,
        displayName: displayName(dependent),
        relationship: grant.relationship,
        scopes: grant.scopes,
        grantedAt: grant.grantedAt.toISOString(),
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      });
    }
    return usable;
  }

  /** The people who may act for this account holder now. */
  async guardiansOf(principal: PortalPrincipal, now = new Date()): Promise<ProxyGuardianView[]> {
    const rows = await this.db
      .select({ grant: portalProxyGrant, guardian: patient })
      .from(portalProxyGrant)
      .innerJoin(patient, and(eq(patient.organizationId, portalProxyGrant.organizationId), eq(patient.id, portalProxyGrant.guardianPatientId)))
      .where(
        and(
          eq(portalProxyGrant.organizationId, principal.organizationId),
          eq(portalProxyGrant.dependentPatientId, principal.patientId),
          isNull(portalProxyGrant.revokedAt),
        ),
      )
      .orderBy(desc(portalProxyGrant.grantedAt));
    return rows
      .filter(({ grant }) => grantLive(grant, now))
      .map(({ grant, guardian }) => ({
        grantId: grant.id,
        displayName: displayName(guardian),
        relationship: grant.relationship,
        scopes: grant.scopes,
        grantedAt: grant.grantedAt.toISOString(),
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      }));
  }

  /** Either side ends the grant from MyHealth: the person acted for takes access back, or the guardian gives it up. */
  async endByPortal(principal: PortalPrincipal, grantId: string): Promise<void> {
    const grant = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(portalProxyGrant)
        .where(
          and(
            eq(portalProxyGrant.organizationId, principal.organizationId),
            eq(portalProxyGrant.id, grantId),
            isNull(portalProxyGrant.revokedAt),
            or(eq(portalProxyGrant.guardianPatientId, principal.patientId), eq(portalProxyGrant.dependentPatientId, principal.patientId)),
          ),
        )
        .for("update");
      if (!row) throw new NotFoundError("Access");
      const byGuardian = row.guardianPatientId === principal.patientId;
      await tx
        .update(portalProxyGrant)
        .set({
          revokedAt: new Date(),
          revokedByPortalAccount: principal.accountId,
          revokedReason: byGuardian ? "Given up by the guardian in MyHealth" : "Ended by the patient in MyHealth",
        })
        .where(eq(portalProxyGrant.id, row.id));
      await this.audit.record(tx, patientAuditContext(principal), {
        action: "portal.proxy-end",
        resourceType: "portal_proxy_grant",
        resourceId: row.id,
        patientId: row.dependentPatientId,
        metadata: { by: byGuardian ? "guardian" : "patient", guardianPatientId: row.guardianPatientId },
      });
      await this.events.record(tx, {
        type: "PortalProxyEnded",
        organizationId: row.organizationId,
        aggregateType: "portal_proxy_grant",
        aggregateId: row.id,
        patientId: row.dependentPatientId,
        payload: { grantId: row.id, by: byGuardian ? "guardian" : "patient" },
      });
      return row;
    });
    await this.tellDependent(grant, "proxy_access_ended");
  }

  // ---- the clinic (staff) -------------------------------------------------------------------

  async overview(actor: Actor, patientId: string): Promise<StaffProxyOverview> {
    await this.requirePatient(actor.organizationId, patientId);
    const rows = await this.db
      .select()
      .from(portalProxyGrant)
      .where(
        and(
          eq(portalProxyGrant.organizationId, actor.organizationId),
          or(eq(portalProxyGrant.dependentPatientId, patientId), eq(portalProxyGrant.guardianPatientId, patientId)),
        ),
      )
      .orderBy(desc(portalProxyGrant.grantedAt))
      .limit(50);
    const views = await this.staffViews(actor.organizationId, rows);
    await this.audit.recordStandalone(actor, { action: "patient.portal-proxy-view", resourceType: "portal_proxy_grant", patientId });
    return { actedForBy: views.filter((v) => v.dependentPatientId === patientId), actingFor: views.filter((v) => v.guardianPatientId === patientId) };
  }

  async grant(actor: Actor, dependentPatientId: string, input: z.infer<typeof grantProxySchema>): Promise<StaffProxyGrantView> {
    const created = await this.db.transaction(async (tx) => {
      const dependent = await this.requirePatient(actor.organizationId, dependentPatientId, tx);
      const [guardian] = await tx
        .select()
        .from(patient)
        .where(and(eq(patient.organizationId, actor.organizationId), eq(patient.patientNumber, input.guardianPatientNumber)));
      if (!guardian) throw new NotFoundError("Guardian's patient record");
      if (guardian.id === dependent.id) throw new BusinessRuleError("A person cannot act for themselves", "proxy_same_patient");
      if (dependent.status !== "active") throw new BusinessRuleError(`A ${dependent.status} patient's record cannot be shared this way`, "patient_not_active");
      if (guardian.status !== "active") throw new BusinessRuleError(`A ${guardian.status} patient cannot act for someone`, "patient_not_active");
      if (!(await this.accounts.hasPortalConsent(tx, actor.organizationId, dependent.id))) {
        throw new BusinessRuleError(
          "Record the patient's portal access consent first (given by the guardian for a child, by the patient otherwise)",
          "portal_consent_required",
        );
      }
      if (!(await this.accounts.activeAccountId(actor.organizationId, guardian.id))) {
        throw new BusinessRuleError("The guardian needs their own active MyHealth account first", "guardian_no_portal_account");
      }
      // One grant at a time per guardian is being written: the limits and the live-pair rule hold.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`proxy:${guardian.id}`}, 0))`);
      const live = await tx
        .select({ id: portalProxyGrant.id, dependent: portalProxyGrant.dependentPatientId })
        .from(portalProxyGrant)
        .where(
          and(
            eq(portalProxyGrant.organizationId, actor.organizationId),
            eq(portalProxyGrant.guardianPatientId, guardian.id),
            isNull(portalProxyGrant.revokedAt),
          ),
        );
      if (live.some((g) => g.dependent === dependent.id)) throw new ConflictError("This person already has access", undefined, "proxy_exists");
      if (live.length >= MAX_DEPENDENTS_PER_GUARDIAN) {
        throw new ConflictError(`A guardian may act for at most ${MAX_DEPENDENTS_PER_GUARDIAN} people`, undefined, "too_many_dependents");
      }
      const expiresAt = input.expiresOn ? new Date(`${input.expiresOn}T23:59:59+08:00`) : null;
      if (expiresAt && expiresAt.getTime() <= Date.now()) throw new BusinessRuleError("The end date must be in the future", "proxy_expiry_in_the_past");
      const [row] = await tx
        .insert(portalProxyGrant)
        .values({
          organizationId: actor.organizationId,
          guardianPatientId: guardian.id,
          dependentPatientId: dependent.id,
          relationship: input.relationship,
          basis: input.basis,
          scopes: [...new Set(input.scopes)],
          verificationNote: input.verificationNote,
          grantedBy: actor.userId,
          expiresAt,
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: "patient.portal-proxy-grant",
        resourceType: "portal_proxy_grant",
        resourceId: row!.id,
        patientId: dependent.id,
        metadata: {
          guardianPatientId: guardian.id,
          relationship: input.relationship,
          basis: input.basis,
          scopes: row!.scopes,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      });
      await this.events.record(tx, {
        type: "PortalProxyGranted",
        organizationId: actor.organizationId,
        aggregateType: "portal_proxy_grant",
        aggregateId: row!.id,
        patientId: dependent.id,
        payload: { grantId: row!.id, guardianPatientId: guardian.id },
      });
      return row!;
    });
    await this.tellDependent(created, "proxy_access_granted");
    const [view] = await this.staffViews(actor.organizationId, [created]);
    return view!;
  }

  async revoke(actor: Actor, dependentPatientId: string, grantId: string, reason: string): Promise<StaffProxyGrantView> {
    const revoked = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(portalProxyGrant)
        .where(
          and(
            eq(portalProxyGrant.organizationId, actor.organizationId),
            eq(portalProxyGrant.id, grantId),
            eq(portalProxyGrant.dependentPatientId, dependentPatientId),
          ),
        )
        .for("update");
      if (!row) throw new NotFoundError("Access");
      if (row.revokedAt) throw new BusinessRuleError("This access has already ended", "proxy_already_ended");
      const [updated] = await tx
        .update(portalProxyGrant)
        .set({ revokedAt: new Date(), revokedByUser: actor.userId, revokedReason: reason })
        .where(eq(portalProxyGrant.id, row.id))
        .returning();
      await this.audit.record(tx, actor, {
        action: "patient.portal-proxy-revoke",
        resourceType: "portal_proxy_grant",
        resourceId: row.id,
        patientId: row.dependentPatientId,
        reason,
        metadata: { guardianPatientId: row.guardianPatientId },
      });
      await this.events.record(tx, {
        type: "PortalProxyEnded",
        organizationId: actor.organizationId,
        aggregateType: "portal_proxy_grant",
        aggregateId: row.id,
        patientId: row.dependentPatientId,
        payload: { grantId: row.id, by: "staff" },
      });
      return updated!;
    });
    await this.tellDependent(revoked, "proxy_access_ended");
    const [view] = await this.staffViews(actor.organizationId, [revoked]);
    return view!;
  }

  // ---- internals ------------------------------------------------------------------------

  private async requirePatient(organizationId: string, patientId: string, executor: Pick<Database, "select"> = this.db) {
    const [row] = await executor
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    if (!row) throw new NotFoundError("Patient");
    return row;
  }

  /** The person whose record it is is told, by email at their own MyHealth account if they have one (a child has none). */
  private async tellDependent(grant: PortalProxyGrantRecord, event: "proxy_access_granted" | "proxy_access_ended"): Promise<void> {
    await this.mailer
      .sendSecurityAlert({ organizationId: grant.organizationId, patientId: grant.dependentPatientId, eventId: `${grant.id}:${event}`, event })
      .catch((error: unknown) => this.logger.warn(`Notice "${event}" was not sent: ${String(error)}`));
  }

  private async staffViews(organizationId: string, grants: PortalProxyGrantRecord[]): Promise<StaffProxyGrantView[]> {
    if (grants.length === 0) return [];
    const ids = [...new Set(grants.flatMap((g) => [g.guardianPatientId, g.dependentPatientId]))];
    const people = new Map(
      (
        await this.db
          .select()
          .from(patient)
          .where(and(eq(patient.organizationId, organizationId), inArray(patient.id, ids)))
      ).map((p) => [p.id, p]),
    );
    const userIds = [...new Set(grants.map((g) => g.grantedBy))];
    const users = new Map(
      (await this.db.select({ id: appUser.id, displayName: appUser.displayName }).from(appUser).where(inArray(appUser.id, userIds))).map((u) => [
        u.id,
        u.displayName,
      ]),
    );
    const now = new Date();
    return grants.map((g) => {
      const guardian = people.get(g.guardianPatientId);
      const dependent = people.get(g.dependentPatientId);
      return {
        id: g.id,
        guardianPatientId: g.guardianPatientId,
        guardianName: guardian ? displayName(guardian) : "Unknown patient",
        guardianNumber: guardian?.patientNumber ?? "",
        dependentPatientId: g.dependentPatientId,
        dependentName: dependent ? displayName(dependent) : "Unknown patient",
        dependentNumber: dependent?.patientNumber ?? "",
        relationship: g.relationship,
        basis: g.basis,
        scopes: g.scopes,
        verificationNote: g.verificationNote,
        grantedAt: g.grantedAt.toISOString(),
        grantedByName: users.get(g.grantedBy) ?? null,
        expiresAt: g.expiresAt?.toISOString() ?? null,
        live: grantLive(g, now),
        revokedAt: g.revokedAt?.toISOString() ?? null,
        revokedReason: g.revokedReason,
        revokedBy: g.revokedAt ? (g.revokedByUser ? "staff" : "patient") : null,
      };
    });
  }
}
