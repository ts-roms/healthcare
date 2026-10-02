import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { DocumentsService } from "@healthcare/documents";
import {
  type Actor,
  ageInYears,
  asPgError,
  BusinessRuleError,
  cleanText,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  normalizeIdentifier,
  NotFoundError,
  PatientMergedError,
  PgErrorCode,
  systemActor,
  todayInPhilippines,
  VersionConflictError,
} from "@healthcare/core";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { type ContactResolution, resolvePatientContact } from "./communication-policy";
import { normalizeContact } from "./contact-normalization";
import { patientMerge } from "./merge/patient-merge.schema";
import type {
  addressInput,
  changeStatusSchema,
  communicationPreferencesSchema,
  contactPointInput,
  identifierInput,
  recordConsentSchema,
  relationshipInput,
  updateDemographicsSchema,
} from "./patient.dto";
import { patientNameFields } from "./patient-registration.service";
import {
  type CommunicationCategory,
  type IdentifierType,
  type CommunicationChannel,
  patient,
  patientAddress,
  patientCommunicationPreference,
  consentText,
  patientConsent,
  patientContactPoint,
  patientIdentifier,
  type PatientRecord,
  patientRelationship,
} from "./patient.schema";
import { type ConsentView, displayName, type MergeLink, type PatientDetail, toConsentView } from "./patient.views";

const DEMOGRAPHIC_FIELDS = [
  "familyName",
  "givenName",
  "middleName",
  "suffix",
  "sex",
  "genderIdentity",
  "birthDate",
  "birthDateIsEstimated",
  "civilStatus",
  "nationality",
  "occupation",
] as const;

type SubRecord = "contact" | "address" | "identifier" | "relationship";

@Injectable()
export class PatientRecordService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  /** Full registration record. Viewing is audited. */
  async getDetail(actor: Actor, patientId: string): Promise<PatientDetail> {
    const record = await this.findPatient(this.db, actor.organizationId, patientId);
    const [contacts, addresses, identifiers, relationships, consents, preferences, merges] = await Promise.all([
      this.db
        .select()
        .from(patientContactPoint)
        .where(and(eq(patientContactPoint.patientId, patientId), eq(patientContactPoint.status, "active"))),
      this.db
        .select()
        .from(patientAddress)
        .where(and(eq(patientAddress.patientId, patientId), eq(patientAddress.status, "active"))),
      this.db
        .select()
        .from(patientIdentifier)
        .where(and(eq(patientIdentifier.patientId, patientId), eq(patientIdentifier.status, "active"))),
      this.db
        .select()
        .from(patientRelationship)
        .where(and(eq(patientRelationship.patientId, patientId), eq(patientRelationship.status, "active"))),
      this.currentConsents(patientId),
      this.db.select().from(patientCommunicationPreference).where(eq(patientCommunicationPreference.patientId, patientId)),
      this.mergeLinks(actor.organizationId, record),
    ]);
    await this.audit.recordStandalone(actor, { action: "patient.view", resourceType: "patient", resourceId: patientId, patientId });
    return {
      id: record.id,
      patientNumber: record.patientNumber,
      displayName: displayName(record),
      familyName: record.familyName,
      givenName: record.givenName,
      middleName: record.middleName,
      suffix: record.suffix,
      sex: record.sex,
      genderIdentity: record.genderIdentity,
      birthDate: record.birthDate,
      birthDateIsEstimated: record.birthDateIsEstimated,
      age: ageInYears(record.birthDate, todayInPhilippines()),
      civilStatus: record.civilStatus,
      nationality: record.nationality,
      occupation: record.occupation,
      status: record.status,
      deceasedAt: record.deceasedAt?.toISOString() ?? null,
      mergedIntoPatientId: record.mergedIntoPatientId,
      mergedInto: merges.mergedInto,
      mergedRecords: merges.mergedRecords,
      registeredFacilityId: record.registeredFacilityId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      version: record.version,
      contacts: contacts.map(({ id, system, value, use, isPrimary }) => ({ id, system, value, use, isPrimary })),
      addresses: addresses.map(({ organizationId: _o, patientId: _p, status: _s, createdBy: _c, retiredAt: _ra, retiredBy: _rb, ...address }) => address),
      identifiers: identifiers.map(({ id, type, value, issuer, validFrom, validUntil }) => ({
        id,
        type,
        value,
        issuer,
        validFrom,
        validUntil,
      })),
      relationships: relationships.map(({ id, relationship, relatedPatientId, name, contactNumber, isEmergencyContact, isLegalGuardian, notes }) => ({
        id,
        relationship,
        relatedPatientId,
        name,
        contactNumber,
        isEmergencyContact,
        isLegalGuardian,
        notes,
      })),
      consents,
      communicationPreferences: preferences.map(({ channel, category, optedIn }) => ({ channel, category, optedIn })),
    };
  }

  async updateDemographics(actor: Actor, patientId: string, input: z.infer<typeof updateDemographicsSchema>): Promise<PatientRecord> {
    const { version, reason, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const before = await this.lockForChange(tx, actor.organizationId, patientId, version);
      const next = { ...changes };
      if (next.familyName) next.familyName = cleanText(next.familyName);
      if (next.givenName) next.givenName = cleanText(next.givenName);
      if (next.middleName) next.middleName = cleanText(next.middleName);
      const nameChanged = "familyName" in next || "givenName" in next || "middleName" in next;
      const nameFields = nameChanged
        ? patientNameFields({
            familyName: next.familyName ?? before.familyName,
            givenName: next.givenName ?? before.givenName,
            middleName: next.middleName === undefined ? before.middleName : next.middleName,
          })
        : {};
      const auditChanges = diffChanges(before, next, DEMOGRAPHIC_FIELDS);
      if (Object.keys(auditChanges).length === 0) return before;
      const [updated] = await tx
        .update(patient)
        .set({ ...next, ...nameFields, updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
        .where(eq(patient.id, patientId))
        .returning();
      if (!updated) throw new NotFoundError("Patient");
      await this.audit.record(tx, actor, {
        action: "patient.update-demographics",
        resourceType: "patient",
        resourceId: patientId,
        patientId,
        reason,
        changes: auditChanges,
      });
      return updated;
    });
  }

  async changeStatus(actor: Actor, patientId: string, input: z.infer<typeof changeStatusSchema>): Promise<PatientRecord> {
    return this.db.transaction(async (tx) => {
      const before = await this.lockForChange(tx, actor.organizationId, patientId, input.version);
      // Reversing a deceased status (a correction) is allowed; the required reason is audited.
      const deceasedAt = input.status === "deceased" && input.deceasedAt ? new Date(input.deceasedAt) : null;
      const [updated] = await tx
        .update(patient)
        .set({ status: input.status, deceasedAt, updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
        .where(eq(patient.id, patientId))
        .returning();
      if (!updated) throw new NotFoundError("Patient");
      await this.audit.record(tx, actor, {
        action: "patient.change-status",
        resourceType: "patient",
        resourceId: patientId,
        patientId,
        reason: input.reason,
        changes: {
          status: { from: before.status, to: input.status },
          ...(deceasedAt ? { deceasedAt: { from: before.deceasedAt, to: deceasedAt } } : {}),
        },
      });
      return updated;
    });
  }

  async addContact(actor: Actor, patientId: string, input: z.infer<typeof contactPointInput>) {
    const valueNormalized = normalizeContact(input.system, input.value);
    return this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      const [existingPrimary] = await tx
        .select({ id: patientContactPoint.id })
        .from(patientContactPoint)
        .where(
          and(
            eq(patientContactPoint.patientId, patientId),
            eq(patientContactPoint.system, input.system),
            eq(patientContactPoint.isPrimary, true),
            eq(patientContactPoint.status, "active"),
          ),
        );
      const isPrimary = input.isPrimary === true || !existingPrimary;
      if (isPrimary && existingPrimary) {
        await tx.update(patientContactPoint).set({ isPrimary: false }).where(eq(patientContactPoint.id, existingPrimary.id));
      }
      const [created] = await tx
        .insert(patientContactPoint)
        .values({
          organizationId: actor.organizationId,
          patientId,
          createdBy: actor.userId,
          system: input.system,
          value: input.value.trim(),
          valueNormalized,
          use: input.use ?? "personal",
          isPrimary,
        })
        .returning();
      await this.auditSubRecord(tx, actor, patientId, "contact", "add", created?.id, { system: input.system, isPrimary });
      return created;
    });
  }

  async addAddress(actor: Actor, patientId: string, input: z.infer<typeof addressInput>) {
    return this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      const [existingPrimary] = await tx
        .select({ id: patientAddress.id })
        .from(patientAddress)
        .where(and(eq(patientAddress.patientId, patientId), eq(patientAddress.isPrimary, true), eq(patientAddress.status, "active")));
      const isPrimary = input.isPrimary === true || !existingPrimary;
      if (isPrimary && existingPrimary) await tx.update(patientAddress).set({ isPrimary: false }).where(eq(patientAddress.id, existingPrimary.id));
      const [created] = await tx
        .insert(patientAddress)
        .values({ ...input, organizationId: actor.organizationId, patientId, createdBy: actor.userId, use: input.use ?? "home", isPrimary })
        .returning();
      await this.auditSubRecord(tx, actor, patientId, "address", "add", created?.id, {
        cityMunicipality: input.cityMunicipality,
        isPrimary,
      });
      return created;
    });
  }

  async addIdentifier(actor: Actor, patientId: string, input: z.infer<typeof identifierInput>) {
    try {
      return await this.db.transaction(async (tx) => {
        await this.assertMutable(tx, actor.organizationId, patientId);
        const [created] = await tx
          .insert(patientIdentifier)
          .values({
            ...input,
            valueNormalized: normalizeIdentifier(input.value),
            organizationId: actor.organizationId,
            patientId,
            createdBy: actor.userId,
          })
          .returning();
        await this.auditSubRecord(tx, actor, patientId, "identifier", "add", created?.id, { type: input.type, issuer: input.issuer });
        return created;
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new ConflictError("This identifier is already assigned to a patient", undefined, "identifier_in_use");
      }
      throw error;
    }
  }

  async addRelationship(actor: Actor, patientId: string, input: z.infer<typeof relationshipInput>) {
    return this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      if (input.relatedPatientId) {
        if (input.relatedPatientId === patientId) throw new BusinessRuleError("A patient cannot be related to themselves", "invalid_relationship");
        await this.findPatient(tx, actor.organizationId, input.relatedPatientId);
      }
      let contactNumberNormalized: string | undefined;
      if (input.contactNumber) {
        try {
          contactNumberNormalized = normalizeContact("mobile", input.contactNumber);
        } catch {
          contactNumberNormalized = input.contactNumber.replace(/[^\d+]/g, "");
        }
      }
      const [created] = await tx
        .insert(patientRelationship)
        .values({ ...input, contactNumberNormalized, organizationId: actor.organizationId, patientId, createdBy: actor.userId })
        .returning();
      await this.auditSubRecord(tx, actor, patientId, "relationship", "add", created?.id, {
        relationship: input.relationship,
        relatedPatientId: input.relatedPatientId,
        isEmergencyContact: input.isEmergencyContact,
      });
      return created;
    });
  }

  /** Sub-records are retired, never deleted, so history is preserved. */
  async retire(actor: Actor, patientId: string, kind: SubRecord, recordId: string, reason: string): Promise<void> {
    const table = {
      contact: patientContactPoint,
      address: patientAddress,
      identifier: patientIdentifier,
      relationship: patientRelationship,
    }[kind];
    await this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      const retired = await tx
        .update(table)
        .set({ status: "retired", retiredAt: new Date(), retiredBy: actor.userId, ...("isPrimary" in table ? { isPrimary: false } : {}) })
        .where(and(eq(table.id, recordId), eq(table.patientId, patientId), eq(table.status, "active")))
        .returning({ id: table.id });
      if (retired.length === 0) throw new NotFoundError(capitalize(kind));
      await this.auditSubRecord(tx, actor, patientId, kind, "retire", recordId, undefined, reason);
    });
  }

  async recordConsent(actor: Actor, patientId: string, input: z.infer<typeof recordConsentSchema>): Promise<ConsentView> {
    if (input.documentId) await this.assertConsentDocument(actor, patientId, input.documentId);
    try {
      return await this.recordConsentTx(actor, patientId, input);
    } catch (error) {
      // The same-patient foreign key (0014) also guards against a document moved or replaced concurrently.
      if (input.documentId && asPgError(error)?.code === PgErrorCode.foreignKeyViolation) throw invalidConsentDocument();
      throw error;
    }
  }

  /** The signed form must be this patient's uploaded consent form (not pending, archived or another category). */
  private async assertConsentDocument(actor: Actor, patientId: string, documentId: string): Promise<void> {
    const doc = await this.documents.get(actor, documentId).catch((error: unknown) => {
      if (error instanceof NotFoundError) throw invalidConsentDocument();
      throw error;
    });
    if (doc.patientId !== patientId || doc.category !== "consent_form" || doc.status !== "available") throw invalidConsentDocument();
  }

  private recordConsentTx(actor: Actor, patientId: string, input: z.infer<typeof recordConsentSchema>): Promise<ConsentView> {
    return this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      const [created] = await tx
        .insert(patientConsent)
        .values({
          organizationId: actor.organizationId,
          patientId,
          consentType: input.consentType,
          decision: input.decision,
          capturedVia: input.capturedVia,
          effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : new Date(),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          documentId: input.documentId ?? null,
          notes: input.notes ?? null,
          recordedBy: actor.userId,
        })
        .returning();
      if (!created) throw new Error("Consent insert returned no row");
      await this.audit.record(tx, actor, {
        action: "patient.consent-record",
        resourceType: "patient_consent",
        resourceId: created.id,
        patientId,
        metadata: {
          consentType: input.consentType,
          decision: input.decision,
          capturedVia: input.capturedVia,
          documentId: input.documentId,
        },
      });
      return toConsentView(created);
    });
  }

  async consentHistory(actor: Actor, patientId: string): Promise<ConsentView[]> {
    await this.findPatient(this.db, actor.organizationId, patientId);
    const rows = await this.db.select().from(patientConsent).where(eq(patientConsent.patientId, patientId)).orderBy(desc(patientConsent.recordedAt));
    await this.audit.recordStandalone(actor, { action: "patient.consent-view", resourceType: "patient_consent", patientId });
    const ids = [...new Set(rows.map((r) => r.consentTextId).filter((id): id is string => Boolean(id)))];
    const versions = ids.length
      ? new Map(
          (await this.db.select({ id: consentText.id, version: consentText.version }).from(consentText).where(inArray(consentText.id, ids))).map((t) => [
            t.id,
            t.version,
          ]),
        )
      : new Map<string, number>();
    return rows.map((row) => ({ ...toConsentView(row), wordingVersion: row.consentTextId ? (versions.get(row.consentTextId) ?? null) : null }));
  }

  async setCommunicationPreferences(actor: Actor, patientId: string, input: z.infer<typeof communicationPreferencesSchema>) {
    return this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      const before = await tx.select().from(patientCommunicationPreference).where(eq(patientCommunicationPreference.patientId, patientId));
      for (const pref of input.preferences) {
        await tx
          .insert(patientCommunicationPreference)
          .values({ organizationId: actor.organizationId, patientId, ...pref, updatedBy: actor.userId, updatedByPortalAccount: null })
          .onConflictDoUpdate({
            target: [patientCommunicationPreference.patientId, patientCommunicationPreference.channel, patientCommunicationPreference.category],
            set: { optedIn: pref.optedIn, updatedAt: new Date(), updatedBy: actor.userId, updatedByPortalAccount: null },
          });
      }
      const changes = Object.fromEntries(
        input.preferences.map((p) => {
          const previous = before.find((b) => b.channel === p.channel && b.category === p.category);
          return [`${p.channel}.${p.category}`, { from: previous?.optedIn ?? null, to: p.optedIn }];
        }),
      );
      await this.audit.record(tx, actor, {
        action: "patient.communication-preferences",
        resourceType: "patient",
        resourceId: patientId,
        patientId,
        changes,
      });
      return tx.select().from(patientCommunicationPreference).where(eq(patientCommunicationPreference.patientId, patientId));
    });
  }

  /** Minimal identification for many patients at once (queue boards, lists). Not audited here. */
  /**
   * The opt-out behind the link in an outreach email (libs/crm): outreach off on that channel, recorded by the platform
   * (neither a staff member nor the MyHealth account) and audited with the campaign it came from. Merged, deceased and
   * inactive records are left as they are: they are never contacted anyway.
   */
  async recordOutreachOptOut(organizationId: string, patientId: string, channel: CommunicationChannel, campaignId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({ id: patient.id, status: patient.status })
        .from(patient)
        .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
      if (!record || record.status !== "active") return;
      const [before] = await tx
        .select({ optedIn: patientCommunicationPreference.optedIn })
        .from(patientCommunicationPreference)
        .where(
          and(
            eq(patientCommunicationPreference.patientId, patientId),
            eq(patientCommunicationPreference.channel, channel),
            eq(patientCommunicationPreference.category, "outreach"),
          ),
        );
      await tx
        .insert(patientCommunicationPreference)
        .values({ organizationId, patientId, channel, category: "outreach", optedIn: false, updatedBy: null, updatedByPortalAccount: null })
        .onConflictDoUpdate({
          target: [patientCommunicationPreference.patientId, patientCommunicationPreference.channel, patientCommunicationPreference.category],
          set: { optedIn: false, updatedAt: new Date(), updatedBy: null, updatedByPortalAccount: null },
        });
      await this.audit.record(tx, systemActor(organizationId, null, "outreach-opt-out-link"), {
        action: "patient.communication-preferences",
        resourceType: "patient",
        resourceId: patientId,
        patientId,
        changes: { [`${channel}.outreach`]: { from: before?.optedIn ?? null, to: false } },
        metadata: { source: "outreach_opt_out_link", campaignId },
      });
    });
  }

  async briefs(organizationId: string, patientIds: string[]) {
    const result = new Map<string, { patientNumber: string; displayName: string; sex: string; age: number }>();
    if (patientIds.length === 0) return result;
    const rows = await this.db
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), inArray(patient.id, patientIds)));
    const today = todayInPhilippines();
    for (const row of rows) {
      result.set(row.id, { patientNumber: row.patientNumber, displayName: displayName(row), sex: row.sex, age: ageInYears(row.birthDate, today) });
    }
    return result;
  }

  /** Sex and birth date for age- and sex-specific reference ranges (laboratory). Not audited here. */
  async demographics(organizationId: string, patientId: string): Promise<{ sex: string; birthDate: string } | undefined> {
    const [row] = await this.db
      .select({ sex: patient.sex, birthDate: patient.birthDate })
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    return row;
  }

  /**
   * Name, sex, birth date and one active identifier of a given type (e.g. `philhealth_pin` for claims).
   * Not audited here: the caller audits the access it serves.
   */
  async identity(organizationId: string, patientId: string, identifierType: IdentifierType) {
    const [row] = await this.db
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    if (!row) return undefined;
    const [id] = await this.db
      .select({ value: patientIdentifier.value })
      .from(patientIdentifier)
      .where(and(eq(patientIdentifier.patientId, patientId), eq(patientIdentifier.type, identifierType), eq(patientIdentifier.status, "active")))
      .orderBy(desc(patientIdentifier.createdAt))
      .limit(1);
    return {
      id: row.id,
      patientNumber: row.patientNumber,
      familyName: row.familyName,
      givenName: row.givenName,
      middleName: row.middleName,
      suffix: row.suffix,
      sex: row.sex,
      birthDate: row.birthDate,
      identifier: id?.value ?? null,
    };
  }

  /** The primary (else first) active address and phone number (case reporting). Not audited here. */
  async primaryAddressAndPhone(organizationId: string, patientId: string) {
    const [addresses, phones] = await Promise.all([
      this.db
        .select()
        .from(patientAddress)
        .where(and(eq(patientAddress.organizationId, organizationId), eq(patientAddress.patientId, patientId), eq(patientAddress.status, "active")))
        .orderBy(desc(patientAddress.isPrimary), desc(patientAddress.createdAt))
        .limit(1),
      this.db
        .select({ value: patientContactPoint.value })
        .from(patientContactPoint)
        .where(
          and(
            eq(patientContactPoint.organizationId, organizationId),
            eq(patientContactPoint.patientId, patientId),
            eq(patientContactPoint.status, "active"),
            inArray(patientContactPoint.system, ["mobile", "phone"]),
          ),
        )
        .orderBy(desc(patientContactPoint.isPrimary))
        .limit(1),
    ]);
    const a = addresses[0];
    return {
      address: a ? { line1: a.line1, barangay: a.barangay, cityMunicipality: a.cityMunicipality, province: a.province, region: a.region } : null,
      contactNumber: phones[0]?.value ?? null,
    };
  }

  /**
   * Records merged into this patient (ADR-0009) by id → patient number: every patient view reads them with the
   * survivor's own records and marks rows filed under another number. Empty for a record nothing was merged into.
   */
  async filedUnderNumbers(organizationId: string, patientId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: patient.id, patientNumber: patient.patientNumber })
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.mergedIntoPatientId, patientId)));
    return new Map(rows.map((r) => [r.id, r.patientNumber]));
  }

  private async mergeLinks(organizationId: string, record: PatientRecord): Promise<{ mergedInto: MergeLink | null; mergedRecords: MergeLink[] }> {
    const [survivors, merged] = await Promise.all([
      record.mergedIntoPatientId
        ? this.db
            .select()
            .from(patient)
            .where(and(eq(patient.organizationId, organizationId), eq(patient.id, record.mergedIntoPatientId)))
        : Promise.resolve([]),
      this.db
        .select()
        .from(patient)
        .where(and(eq(patient.organizationId, organizationId), eq(patient.mergedIntoPatientId, record.id)))
        .orderBy(asc(patient.patientNumber)),
    ]);
    // When each link was made: the latest merge or re-point of each retired record.
    const retiredIds = [...(record.mergedIntoPatientId ? [record.id] : []), ...merged.map((m) => m.id)];
    const history = retiredIds.length
      ? await this.db
          .selectDistinctOn([patientMerge.retiredPatientId], {
            retiredPatientId: patientMerge.retiredPatientId,
            performedAt: patientMerge.performedAt,
            performedBy: patientMerge.performedBy,
          })
          .from(patientMerge)
          .where(and(eq(patientMerge.organizationId, organizationId), inArray(patientMerge.retiredPatientId, retiredIds)))
          .orderBy(patientMerge.retiredPatientId, desc(patientMerge.performedAt), desc(patientMerge.id))
      : [];
    const at = new Map(history.map((h) => [h.retiredPatientId, h]));
    const link = (p: PatientRecord, retiredId: string): MergeLink => ({
      id: p.id,
      patientNumber: p.patientNumber,
      displayName: displayName(p),
      mergedAt: at.get(retiredId)?.performedAt.toISOString() ?? null,
      mergedBy: at.get(retiredId)?.performedBy ?? null,
    });
    const survivor = survivors[0];
    return { mergedInto: survivor ? link(survivor, record.id) : null, mergedRecords: merged.map((m) => link(m, m.id)) };
  }

  /** Destination and permission for contacting a patient (used by notifications). */
  async resolveContact(
    organizationId: string,
    patientId: string,
    channel: CommunicationChannel,
    category: CommunicationCategory,
    portalActive = false,
    pushAccountId?: string,
  ): Promise<ContactResolution> {
    const [record] = await this.db
      .select({ status: patient.status })
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    if (!record) return { allowed: false, reason: "patient_not_found" };
    const [preference] = await this.db
      .select({ optedIn: patientCommunicationPreference.optedIn })
      .from(patientCommunicationPreference)
      .where(
        and(
          eq(patientCommunicationPreference.patientId, patientId),
          eq(patientCommunicationPreference.channel, channel),
          eq(patientCommunicationPreference.category, category),
        ),
      );
    const primaries = await this.db
      .select({ system: patientContactPoint.system, value: patientContactPoint.valueNormalized })
      .from(patientContactPoint)
      .where(and(eq(patientContactPoint.patientId, patientId), eq(patientContactPoint.isPrimary, true), eq(patientContactPoint.status, "active")));
    return resolvePatientContact({
      status: record.status,
      channel,
      category,
      optedIn: preference?.optedIn,
      primaryMobile: primaries.find((c) => c.system === "mobile")?.value,
      primaryEmail: primaries.find((c) => c.system === "email")?.value,
      portalActive,
      pushAccountId,
    });
  }

  /** Current (latest) decision per consent type. */
  private async currentConsents(patientId: string): Promise<ConsentView[]> {
    const rows = await this.db
      .selectDistinctOn([patientConsent.consentType])
      .from(patientConsent)
      .where(eq(patientConsent.patientId, patientId))
      .orderBy(patientConsent.consentType, desc(patientConsent.recordedAt), desc(patientConsent.id));
    return rows.map(toConsentView);
  }

  async findPatient(executor: DbExecutor, organizationId: string, patientId: string): Promise<PatientRecord> {
    const [row] = await executor
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    if (!row) throw new NotFoundError("Patient");
    return row;
  }

  private async assertMutable(tx: DbExecutor, organizationId: string, patientId: string): Promise<PatientRecord> {
    const [row] = await tx
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId), ne(patient.status, "merged")))
      .for("update");
    if (!row) {
      const merged = await this.findPatient(tx, organizationId, patientId);
      throw new PatientMergedError(merged.mergedIntoPatientId);
    }
    return row;
  }

  private async lockForChange(tx: DbExecutor, organizationId: string, patientId: string, expectedVersion: number): Promise<PatientRecord> {
    const row = await this.assertMutable(tx, organizationId, patientId);
    if (row.version !== expectedVersion) throw new VersionConflictError("Patient", expectedVersion);
    return row;
  }

  private auditSubRecord(
    tx: DbExecutor,
    actor: Actor,
    patientId: string,
    kind: SubRecord,
    verb: "add" | "retire",
    recordId: string | undefined,
    metadata?: Record<string, unknown>,
    reason?: string,
  ) {
    return this.audit.record(tx, actor, {
      action: `patient.${kind}-${verb}`,
      resourceType: `patient_${kind}`,
      resourceId: recordId,
      patientId,
      reason,
      metadata,
    });
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function invalidConsentDocument(): BusinessRuleError {
  return new BusinessRuleError("The attached document must be this patient's uploaded consent form", "consent_document_invalid");
}
