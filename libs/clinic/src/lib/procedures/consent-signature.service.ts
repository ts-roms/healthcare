import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  NotFoundError,
  PgErrorCode,
  requireFacilityId,
  systemActor,
  VersionConflictError,
} from "@healthcare/core";
import { documentSignature } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import { loadSigningSetting, type ConsentSigningSettingView } from "./consent-signing.settings";
import type { cancelSignatureRequestSchema, createSignatureRequestSchema, updateSigningSettingSchema } from "./procedure.dto";
import { representativeRequired, signatureRequestExpiry, signatureRequestProblem, signerProblem } from "./procedure.rules";
import { PROCEDURE_STAFF_NAMES, type ProcedureStaffNames } from "./ports";
import {
  clinicProcedureConsentWording,
  clinicProcedureDefinition,
  type ConsentSignatureRequestRecord,
  consentSignatureRequest,
  consentSigningSetting,
} from "./procedure.schema";
import { ClinicProcedureService, type SignedConsentResult } from "./procedure.service";

/** A signature request as staff see it. */
export interface ConsentSignatureRequestView {
  id: string;
  patientId: string;
  definitionId: string;
  procedureCode: string;
  procedureName: string;
  wordingVersion: number;
  representativeRequired: boolean;
  status: "pending" | "signed" | "cancelled";
  /** Pending but past its expiry. */
  expired: boolean;
  requestedAt: string;
  requestedByName: string | null;
  expiresAt: string;
  signedAt: string | null;
  signedDocumentId: string | null;
  cancelReason: string | null;
}

/** A form awaiting signature as the patient (or their guardian) reads it in MyHealth. */
export interface PortalFormView {
  id: string;
  procedureName: string;
  facilityName: string;
  wording: { title: string; body: string; version: number };
  /** A parent or guardian must sign: the patient is under the organization's age. */
  representativeRequired: boolean;
  requestedAt: string;
  expiresAt: string;
}

/** Who signs in MyHealth: the signed-in account, and the person it acts for when it is a guardian. */
export interface PortalSigner {
  audit: PatientAuditContext;
  /** The patient whose form it is (the dependent when acting for someone). */
  patientId: string;
  accountId: string;
  /** Set when the account holder acts for the patient (a guardian's grant). */
  proxyGrantId: string | null;
  /** The account holder's own patient record (their name is printed under the signature). */
  signerPatientId: string;
  relationship: string | null;
  device: string | null;
}

/**
 * Consent forms signed in MyHealth (docs/architecture/electronic-signatures.md, phase 2). The clinic asks a patient to sign a
 * procedure's consent form (the wording version is fixed when it asks); the patient — or the guardian acting for them — reads it
 * and signs by drawing, after the API has confirmed the account holder's password again. A minor's form is signed by a parent
 * or guardian (the organization's age). The signed form is stored like one signed at the clinic and linked when the consent is
 * recorded; nothing here decides who may sign for whom (the clinic's grant of guardian access does) or whether a drawn
 * signature is valid.
 */
@Injectable()
export class ConsentSignatureService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly procedures: ClinicProcedureService,
    private readonly organizations: OrganizationService,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
    @Inject(PROCEDURE_STAFF_NAMES) private readonly staff: ProcedureStaffNames,
  ) {}

  // ---- the organization's choices ----------------------------------------------------------------------------------

  settings(actor: Actor): Promise<ConsentSigningSettingView> {
    return loadSigningSetting(this.db, actor.organizationId);
  }

  async updateSettings(actor: Actor, input: z.output<typeof updateSigningSettingSchema>): Promise<ConsentSigningSettingView> {
    await this.db.transaction(async (tx) => {
      const values = {
        minorAgeYears: input.minorAgeYears,
        portalSigningEnabled: input.portalSigningEnabled,
        requestValidDays: input.requestValidDays,
        updatedBy: actor.userId!,
        updatedAt: new Date(),
      };
      if (input.version === 0) {
        try {
          await tx.insert(consentSigningSetting).values({ organizationId: actor.organizationId, ...values });
        } catch (error) {
          if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new VersionConflictError("Signing settings", input.version);
          throw error;
        }
      } else {
        const updated = await tx
          .update(consentSigningSetting)
          .set({ ...values, version: input.version + 1 })
          .where(and(eq(consentSigningSetting.organizationId, actor.organizationId), eq(consentSigningSetting.version, input.version)))
          .returning({ version: consentSigningSetting.version });
        if (!updated.length) throw new VersionConflictError("Signing settings", input.version);
      }
      await this.audit.record(tx, actor, {
        action: "clinic.consent-signing-settings.update",
        resourceType: "consent_signing_setting",
        resourceId: actor.organizationId,
        metadata: { minorAgeYears: input.minorAgeYears, portalSigningEnabled: input.portalSigningEnabled, requestValidDays: input.requestValidDays },
      });
    });
    return loadSigningSetting(this.db, actor.organizationId);
  }

  // ---- requests (staff) --------------------------------------------------------------------------------------------

  /** Asks a patient to sign a procedure's consent form in MyHealth (the current wording is fixed on the request). */
  async create(actor: Actor, patientId: string, input: z.output<typeof createSignatureRequestSchema>): Promise<ConsentSignatureRequestView> {
    const facilityId = requireFacilityId(actor);
    const setting = await loadSigningSetting(this.db, actor.organizationId);
    if (!setting.portalSigningEnabled) throw new BusinessRuleError("Signing in MyHealth is not turned on for this organization", "portal_signing_disabled");
    const form = await this.procedures.loadConsentForm(actor.organizationId, facilityId, input.definitionId, patientId);
    if (form.definition.status !== "active") throw new BusinessRuleError("This procedure is no longer offered", "procedure_inactive");
    const now = new Date();
    try {
      const id = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(consentSignatureRequest)
          .values({
            organizationId: actor.organizationId,
            facilityId,
            patientId,
            definitionId: input.definitionId,
            wordingId: form.wording.id,
            wordingVersion: form.wording.version,
            representativeRequired: representativeRequired(form.patient.age, setting.minorAgeYears),
            requestedBy: actor.userId!,
            requestedAt: now,
            expiresAt: signatureRequestExpiry(now, setting.requestValidDays),
          })
          .returning();
        const created = row!;
        await this.audit.record(tx, actor, {
          action: "clinic.consent-signature-request.create",
          resourceType: "consent_signature_request",
          resourceId: created.id,
          patientId,
          metadata: { definitionId: input.definitionId, wordingVersion: form.wording.version, representativeRequired: created.representativeRequired },
        });
        await this.events.record(tx, {
          type: "ConsentSignatureRequested",
          organizationId: actor.organizationId,
          aggregateType: "consent_signature_request",
          aggregateId: created.id,
          facilityId,
          patientId,
          payload: { requestId: created.id, definitionId: input.definitionId },
        });
        return created.id;
      });
      return (await this.views(actor.organizationId, [await this.find(actor.organizationId, id)]))[0]!;
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new BusinessRuleError("A request for this procedure is already open for the patient", "request_already_open");
      }
      throw error;
    }
  }

  async list(actor: Actor, patientId: string): Promise<ConsentSignatureRequestView[]> {
    const rows = await this.db
      .select()
      .from(consentSignatureRequest)
      .where(and(eq(consentSignatureRequest.organizationId, actor.organizationId), eq(consentSignatureRequest.patientId, patientId)))
      .orderBy(desc(consentSignatureRequest.requestedAt));
    return this.views(actor.organizationId, rows);
  }

  async cancel(actor: Actor, requestId: string, input: z.output<typeof cancelSignatureRequestSchema>): Promise<ConsentSignatureRequestView> {
    const current = await this.find(actor.organizationId, requestId);
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(consentSignatureRequest)
        .set({ status: "cancelled", cancelledBy: actor.userId!, cancelledAt: new Date(), cancelReason: input.reason })
        .where(
          and(
            eq(consentSignatureRequest.organizationId, actor.organizationId),
            eq(consentSignatureRequest.id, requestId),
            eq(consentSignatureRequest.status, "pending"),
          ),
        )
        .returning({ id: consentSignatureRequest.id });
      if (!updated) throw new BusinessRuleError("The request is no longer open", "request_not_pending");
      await this.audit.record(tx, actor, {
        action: "clinic.consent-signature-request.cancel",
        resourceType: "consent_signature_request",
        resourceId: requestId,
        patientId: current.patientId,
        reason: input.reason,
      });
    });
    return (await this.views(actor.organizationId, [await this.find(actor.organizationId, requestId)]))[0]!;
  }

  // ---- MyHealth ----------------------------------------------------------------------------------------------------

  /** Forms awaiting this patient's signature (pending and not expired), when the organization signs in MyHealth. */
  async portalList(organizationId: string, patientId: string, now = new Date()): Promise<PortalFormView[]> {
    const setting = await loadSigningSetting(this.db, organizationId);
    if (!setting.portalSigningEnabled) return [];
    const rows = (
      await this.db
        .select()
        .from(consentSignatureRequest)
        .where(
          and(
            eq(consentSignatureRequest.organizationId, organizationId),
            eq(consentSignatureRequest.patientId, patientId),
            eq(consentSignatureRequest.status, "pending"),
          ),
        )
        .orderBy(desc(consentSignatureRequest.requestedAt))
    ).filter((row) => row.expiresAt.getTime() > now.getTime());
    if (!rows.length) return [];
    const [definitions, wordings] = await Promise.all([
      this.db
        .select({ id: clinicProcedureDefinition.id, name: clinicProcedureDefinition.name })
        .from(clinicProcedureDefinition)
        .where(
          and(
            eq(clinicProcedureDefinition.organizationId, organizationId),
            inArray(clinicProcedureDefinition.id, [...new Set(rows.map((r) => r.definitionId))]),
          ),
        ),
      this.db
        .select()
        .from(clinicProcedureConsentWording)
        .where(
          and(
            eq(clinicProcedureConsentWording.organizationId, organizationId),
            inArray(clinicProcedureConsentWording.id, [...new Set(rows.map((r) => r.wordingId))]),
          ),
        ),
    ]);
    const facilities = new Map<string, string>();
    for (const facilityId of new Set(rows.map((r) => r.facilityId))) {
      facilities.set(facilityId, (await this.organizations.getFacility(organizationId, facilityId)).name);
    }
    const definitionName = new Map(definitions.map((d) => [d.id, d.name]));
    const wordingById = new Map(wordings.map((w) => [w.id, w]));
    return rows.flatMap((row) => {
      const wording = wordingById.get(row.wordingId);
      if (!wording) return [];
      return [
        {
          id: row.id,
          procedureName: definitionName.get(row.definitionId) ?? "Procedure",
          facilityName: facilities.get(row.facilityId) ?? "",
          wording: { title: wording.title, body: wording.body, version: wording.version },
          representativeRequired: row.representativeRequired,
          requestedAt: row.requestedAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        },
      ];
    });
  }

  /**
   * Signs a requested form in MyHealth. The caller has confirmed the account holder's password just now (that is the
   * identity evidence); a guardian acting for the patient signs as their representative, and a minor's form is refused to the
   * patient's own account. Idempotent: signing a request that was already signed with this id returns the same document.
   */
  async portalSign(signer: PortalSigner, requestId: string, strokes: number[][][]): Promise<SignedConsentResult> {
    const organizationId = signer.audit.organizationId;
    const setting = await loadSigningSetting(this.db, organizationId);
    if (!setting.portalSigningEnabled) throw new BusinessRuleError("Signing in MyHealth is not turned on", "portal_signing_disabled");
    const [request] = await this.db
      .select()
      .from(consentSignatureRequest)
      .where(
        and(
          eq(consentSignatureRequest.organizationId, organizationId),
          eq(consentSignatureRequest.id, requestId),
          eq(consentSignatureRequest.patientId, signer.patientId),
        ),
      );
    if (!request) throw new NotFoundError("Form");
    // A retry of a request this account already signed returns what was stored.
    if (request.status === "signed" && request.signedDocumentId) {
      const [signature] = await this.db
        .select()
        .from(documentSignature)
        .where(and(eq(documentSignature.organizationId, organizationId), eq(documentSignature.documentId, request.signedDocumentId)));
      if (signature && signature.portalAccountId === signer.accountId) {
        return { documentId: request.signedDocumentId, signatureId: signature.id, signedAt: signature.signedAt.toISOString() };
      }
    }
    const problem = signatureRequestProblem({ status: request.status, expiresAt: request.expiresAt }, new Date());
    if (problem) {
      throw new BusinessRuleError(problem === "request_expired" ? "This form is no longer open for signing" : "This form has already been answered", problem);
    }
    const signerKind = signer.proxyGrantId ? "representative" : "patient";
    if (signerProblem(signerKind, request.representativeRequired)) {
      throw new BusinessRuleError("This patient is a minor: a parent or guardian signs the form", "minor_requires_representative");
    }
    const form = await this.procedures.loadConsentForm(organizationId, request.facilityId, request.definitionId, request.patientId, request.wordingId);
    const signerBrief = (await this.patients.summaries(organizationId, [signer.signerPatientId])).get(signer.signerPatientId);
    if (!signerBrief) throw new NotFoundError("Signer");
    const actor = systemActor(organizationId, request.facilityId, "portal-consent-signing");
    return this.procedures.storeSignedConsent(
      actor,
      form,
      {
        documentId: request.id,
        patientId: request.patientId,
        definitionId: request.definitionId,
        signerKind,
        signerName: signerBrief.displayName,
        signerRelationship: signerKind === "representative" ? (signer.relationship ?? "representative").replaceAll("_", " ") : null,
        strokes,
        identity: { method: "portal_password", portalAccountId: signer.accountId, proxyGrantId: signer.proxyGrantId },
        device: signer.device,
        requestId: request.id,
      },
      {
        auditAs: signer.audit,
        within: async (tx) => {
          const [answered] = await tx
            .update(consentSignatureRequest)
            .set({ status: "signed", signedDocumentId: request.id, signedAt: new Date() })
            .where(
              and(
                eq(consentSignatureRequest.organizationId, organizationId),
                eq(consentSignatureRequest.id, request.id),
                eq(consentSignatureRequest.status, "pending"),
              ),
            )
            .returning({ id: consentSignatureRequest.id });
          if (!answered) {
            // Already answered by this very document (a retry), or by someone else a moment ago.
            const [now] = await tx.select().from(consentSignatureRequest).where(eq(consentSignatureRequest.id, request.id));
            if (now?.status === "signed" && now.signedDocumentId === request.id) return;
            throw new BusinessRuleError("This form has already been answered", "request_not_pending");
          }
          await this.audit.record(tx, signer.audit, {
            action: "portal.consent-form-sign",
            resourceType: "consent_signature_request",
            resourceId: request.id,
            patientId: request.patientId,
            metadata: { definitionId: request.definitionId, wordingVersion: request.wordingVersion, asRepresentative: signerKind === "representative" },
          });
          await this.events.record(tx, {
            type: "ConsentSignatureSigned",
            organizationId,
            aggregateType: "consent_signature_request",
            aggregateId: request.id,
            facilityId: request.facilityId,
            patientId: request.patientId,
            payload: { requestId: request.id, definitionId: request.definitionId, documentId: request.id },
          });
        },
      },
    );
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private async find(organizationId: string, requestId: string): Promise<ConsentSignatureRequestRecord> {
    const [row] = await this.db
      .select()
      .from(consentSignatureRequest)
      .where(and(eq(consentSignatureRequest.organizationId, organizationId), eq(consentSignatureRequest.id, requestId)));
    if (!row) throw new NotFoundError("Signature request");
    return row;
  }

  private async views(organizationId: string, rows: ConsentSignatureRequestRecord[]): Promise<ConsentSignatureRequestView[]> {
    if (!rows.length) return [];
    const [definitions, names] = await Promise.all([
      this.db
        .select({ id: clinicProcedureDefinition.id, code: clinicProcedureDefinition.code, name: clinicProcedureDefinition.name })
        .from(clinicProcedureDefinition)
        .where(
          and(
            eq(clinicProcedureDefinition.organizationId, organizationId),
            inArray(clinicProcedureDefinition.id, [...new Set(rows.map((r) => r.definitionId))]),
          ),
        ),
      this.staff.staffNames(organizationId, [...new Set(rows.map((r) => r.requestedBy))]),
    ]);
    const byId = new Map(definitions.map((d) => [d.id, d]));
    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      patientId: row.patientId,
      definitionId: row.definitionId,
      procedureCode: byId.get(row.definitionId)?.code ?? "",
      procedureName: byId.get(row.definitionId)?.name ?? "",
      wordingVersion: row.wordingVersion,
      representativeRequired: row.representativeRequired,
      status: row.status,
      expired: row.status === "pending" && row.expiresAt.getTime() <= now,
      requestedAt: row.requestedAt.toISOString(),
      requestedByName: names.get(row.requestedBy) ?? null,
      expiresAt: row.expiresAt.toISOString(),
      signedAt: row.signedAt?.toISOString() ?? null,
      signedDocumentId: row.signedDocumentId,
      cancelReason: row.cancelReason,
    }));
  }
}
