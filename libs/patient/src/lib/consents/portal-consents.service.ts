import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { BadRequestError, BusinessRuleError, DATABASE, type Database, DomainEventPublisher } from "@healthcare/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { CONSENT_TYPES, type ConsentType, patientConsent, type PatientConsentRecord } from "../patient.schema";
import { patientPortalSession } from "../portal/portal.schema";
import { patientAuditContext, type PortalPrincipal } from "../portal/portal-account.service";
import { consentInEffect, patientMayWithdraw } from "./portal-consent.rules";
import type { PatientConsentDecisionView, PatientConsentView } from "./portal-consent.views";

/**
 * The patient's consents in MyHealth (docs/architecture/portal-app.md, "Privacy and consents"): the
 * current decision and history per consent type, and withdrawal of the consents MyHealth offers (portal-consent.rules.ts).
 * A withdrawal is a new consent decision recorded by the patient's MyHealth account (electronic, effective at once);
 * consents are append-only. Withdrawing portal access ends MyHealth: every session of the account is revoked in the
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
    return CONSENT_TYPES.map((consentType) => {
      const history = rows.filter((r) => r.consentType === consentType);
      const latest = history[0];
      const inEffect = Boolean(latest && consentInEffect(latest, now));
      return {
        consentType,
        current: latest ? toDecisionView(latest) : null,
        inEffect,
        canWithdraw: inEffect && patientMayWithdraw(consentType),
        history: history.map(toDecisionView),
      };
    });
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

function toDecisionView(c: PatientConsentRecord): PatientConsentDecisionView {
  return {
    id: c.id,
    decision: c.decision,
    effectiveAt: c.effectiveAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    recordedAt: c.recordedAt.toISOString(),
    recordedVia: c.recordedByPortalAccount ? "myhealth" : "clinic",
  };
}
