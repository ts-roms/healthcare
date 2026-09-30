import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  BadRequestError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
} from "@healthcare/core";
import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { CONSENT_TYPES, type ConsentType, consentText, patientConsent, type PatientConsentRecord } from "../patient.schema";
import { patientPortalSession } from "../portal/portal.schema";
import { patientAuditContext, type PortalPrincipal } from "../portal/portal-account.service";
import { consentInEffect, patientMayGrant, patientMayWithdraw } from "./portal-consent.rules";
import type { ConsentWordingView, PatientConsentDecisionView, PatientConsentView } from "./portal-consent.views";

/**
 * The patient's consents in MyHealth (docs/architecture/portal-app.md, "Privacy and consents"): the
 * current decision and history per consent type, withdrawal of the consents MyHealth offers, and giving consents against
 * the organization's own wording (portal-consent.rules.ts; `consent_text`, migration 0076).
 * A withdrawal or a grant is a new consent decision recorded by the patient's MyHealth account (electronic, effective at
 * once; a grant records the wording version the patient read and confirmed); consents are append-only. Withdrawing portal access ends MyHealth: every session of the account is revoked in the
 * same transaction, and signing in is refused until the clinic records a new grant.
 */
@Injectable()
export class PortalConsentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  async list(principal: PortalPrincipal): Promise<PatientConsentView[]> {
    const rows = await this.db
      .select()
      .from(patientConsent)
      .where(and(eq(patientConsent.organizationId, principal.organizationId), eq(patientConsent.patientId, principal.patientId)))
      .orderBy(desc(patientConsent.recordedAt), desc(patientConsent.id));
    await this.audit.recordStandalone(patientAuditContext(principal), {
      action: "portal.consent-view",
      resourceType: "patient_consent",
      patientId: principal.patientId,
      metadata: { count: rows.length },
    });
    const now = new Date();
    const offered = await this.offeredWording(this.db, principal.organizationId);
    const versions = await this.wordingVersions(rows);
    return CONSENT_TYPES.map((consentType) => {
      const history = rows.filter((r) => r.consentType === consentType);
      const latest = history[0];
      const inEffect = Boolean(latest && consentInEffect(latest, now));
      return {
        consentType,
        current: latest ? toDecisionView(latest, versions) : null,
        inEffect,
        canWithdraw: inEffect && patientMayWithdraw(consentType),
        canGive: !inEffect && patientMayGrant(consentType) && offered.has(consentType),
        history: history.map((h) => toDecisionView(h, versions)),
      };
    });
  }

  /** The wording of a consent the organization offers online, for the patient to read before giving it. */
  async wording(principal: PortalPrincipal, consentType: string): Promise<ConsentWordingView> {
    const type = this.grantableType(consentType);
    const current = (await this.offeredWording(this.db, principal.organizationId)).get(type);
    if (!current) throw new NotFoundError("Consent wording");
    await this.audit.recordStandalone(patientAuditContext(principal), {
      action: "portal.consent-wording-view",
      resourceType: "consent_text",
      resourceId: current.id,
      patientId: principal.patientId,
      metadata: { consentType: type, version: current.version },
    });
    return current;
  }

  /**
   * The patient gives a consent, having read the organization's wording (`consentTextId` must be the version offered
   * now: if the wording changed while they read, they are shown the new one first). Recorded electronically by their
   * account with the version, effective at once.
   */
  async give(principal: PortalPrincipal, consentType: string, consentTextId: string): Promise<PatientConsentDecisionView> {
    const type = this.grantableType(consentType);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`patient-consent:${principal.organizationId}:${principal.patientId}:${type}`}, 0))`);
      const current = (await this.offeredWording(tx, principal.organizationId)).get(type);
      if (!current) throw new BusinessRuleError("The clinic does not offer this consent online. Please give it at the clinic.", "consent_not_offered_online");
      if (current.id !== consentTextId) {
        throw new ConflictError("The clinic changed the wording while you were reading. Please read it again.", undefined, "consent_wording_changed");
      }
      const [latest] = await tx
        .select()
        .from(patientConsent)
        .where(
          and(
            eq(patientConsent.organizationId, principal.organizationId),
            eq(patientConsent.patientId, principal.patientId),
            eq(patientConsent.consentType, type),
          ),
        )
        .orderBy(desc(patientConsent.recordedAt), desc(patientConsent.id))
        .limit(1);
      const now = new Date();
      if (latest && consentInEffect(latest, now)) throw new BusinessRuleError("This consent is already given", "consent_already_given");
      const [created] = await tx
        .insert(patientConsent)
        .values({
          organizationId: principal.organizationId,
          patientId: principal.patientId,
          consentType: type,
          decision: "granted",
          effectiveAt: now,
          capturedVia: "electronic",
          recordedByPortalAccount: principal.accountId,
          consentTextId: current.id,
          recordedAt: now,
        })
        .returning();
      await this.audit.record(tx, patientAuditContext(principal), {
        action: "portal.consent-give",
        resourceType: "patient_consent",
        resourceId: created!.id,
        patientId: principal.patientId,
        metadata: { consentType: type, consentTextId: current.id, wordingVersion: current.version, previous: latest?.id ?? null },
      });
      await this.events.record(tx, {
        type: "PatientConsentGiven",
        organizationId: principal.organizationId,
        aggregateType: "patient_consent",
        aggregateId: created!.id,
        patientId: principal.patientId,
        payload: { consentId: created!.id, consentType: type, recordedVia: "myhealth", wordingVersion: current.version },
      });
      return toDecisionView(created!, new Map([[current.id, current.version]]));
    });
  }

  private grantableType(consentType: string): ConsentType {
    if (!(CONSENT_TYPES as readonly string[]).includes(consentType)) throw new BadRequestError("Unknown consent type");
    const type = consentType as ConsentType;
    if (!patientMayGrant(type)) {
      throw new BusinessRuleError("This consent is given at the clinic, which explains it in person", "consent_give_at_clinic");
    }
    return type;
  }

  /** The latest version of each consent type's wording, for the types the organization offers online right now. */
  private async offeredWording(executor: DbExecutor, organizationId: string): Promise<Map<ConsentType, ConsentWordingView>> {
    const latest = await executor
      .select({ consentType: consentText.consentType, version: max(consentText.version) })
      .from(consentText)
      .where(eq(consentText.organizationId, organizationId))
      .groupBy(consentText.consentType);
    const result = new Map<ConsentType, ConsentWordingView>();
    for (const { consentType, version } of latest) {
      if (version === null) continue;
      const [row] = await executor
        .select()
        .from(consentText)
        .where(and(eq(consentText.organizationId, organizationId), eq(consentText.consentType, consentType), eq(consentText.version, version)));
      if (row?.offered && row.title && row.body && row.acknowledgement) {
        result.set(consentType, { id: row.id, consentType, version: row.version, title: row.title, body: row.body, acknowledgement: row.acknowledgement });
      }
    }
    return result;
  }

  /** The wording versions behind the consents given online (id → version), for showing "wording v2". */
  private async wordingVersions(rows: PatientConsentRecord[]): Promise<Map<string, number>> {
    const ids = [...new Set(rows.map((r) => r.consentTextId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const texts = await this.db.select({ id: consentText.id, version: consentText.version }).from(consentText).where(inArray(consentText.id, ids));
    return new Map(texts.map((t) => [t.id, t.version]));
  }

  async withdraw(principal: PortalPrincipal, consentType: string): Promise<PatientConsentDecisionView> {
    if (!(CONSENT_TYPES as readonly string[]).includes(consentType)) throw new BadRequestError("Unknown consent type");
    const type = consentType as ConsentType;
    if (!patientMayWithdraw(type)) {
      throw new BusinessRuleError(
        "This consent is withdrawn with the clinic, which explains what it means for your care and records",
        "consent_withdraw_at_clinic",
      );
    }
    return this.db.transaction(async (tx) => {
      // One decision at a time per patient and consent type.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`patient-consent:${principal.organizationId}:${principal.patientId}:${type}`}, 0))`);
      const [latest] = await tx
        .select()
        .from(patientConsent)
        .where(
          and(
            eq(patientConsent.organizationId, principal.organizationId),
            eq(patientConsent.patientId, principal.patientId),
            eq(patientConsent.consentType, type),
          ),
        )
        .orderBy(desc(patientConsent.recordedAt), desc(patientConsent.id))
        .limit(1);
      const now = new Date();
      if (!latest || !consentInEffect(latest, now)) throw new BusinessRuleError("This consent is not currently given", "consent_not_in_effect");
      const [created] = await tx
        .insert(patientConsent)
        .values({
          organizationId: principal.organizationId,
          patientId: principal.patientId,
          consentType: type,
          decision: "withdrawn",
          effectiveAt: now,
          capturedVia: "electronic",
          recordedByPortalAccount: principal.accountId,
          recordedAt: now,
        })
        .returning();
      if (type === "portal_access") {
        await tx
          .update(patientPortalSession)
          .set({ revokedAt: now, revokedReason: "portal_consent_withdrawn" })
          .where(and(eq(patientPortalSession.accountId, principal.accountId), isNull(patientPortalSession.revokedAt)));
      }
      await this.audit.record(tx, patientAuditContext(principal), {
        action: "portal.consent-withdraw",
        resourceType: "patient_consent",
        resourceId: created!.id,
        patientId: principal.patientId,
        metadata: { consentType: type, previous: latest.id },
      });
      await this.events.record(tx, {
        type: "PatientConsentWithdrawn",
        organizationId: principal.organizationId,
        aggregateType: "patient_consent",
        aggregateId: created!.id,
        patientId: principal.patientId,
        payload: { consentId: created!.id, consentType: type, recordedVia: "myhealth" },
      });
      return toDecisionView(created!);
    });
  }
}

function toDecisionView(c: PatientConsentRecord, versions: Map<string, number> = new Map()): PatientConsentDecisionView {
  return {
    id: c.id,
    decision: c.decision,
    effectiveAt: c.effectiveAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    recordedAt: c.recordedAt.toISOString(),
    recordedVia: c.recordedByPortalAccount ? "myhealth" : "clinic",
    wordingVersion: c.consentTextId ? (versions.get(c.consentTextId) ?? null) : null,
  };
}
