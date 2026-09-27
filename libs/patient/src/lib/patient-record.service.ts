import { Inject, Injectable } from '@nestjs/common';
import { AuditService, diffChanges } from '@healthcare/audit';
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
  PgErrorCode,
  todayInPhilippines,
  VersionConflictError,
} from '@healthcare/core';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type ContactResolution, resolvePatientContact } from './communication-policy';
import { normalizeContact } from './contact-normalization';
import type {
  addressInput,
  changeStatusSchema,
  communicationPreferencesSchema,
  contactPointInput,
  identifierInput,
  recordConsentSchema,
  relationshipInput,
  updateDemographicsSchema,
} from './patient.dto';
import { patientNameFields } from './patient-registration.service';
import {
  type CommunicationCategory,
  type CommunicationChannel,
  patient,
  patientAddress,
  patientCommunicationPreference,
  patientConsent,
  patientContactPoint,
  patientIdentifier,
  type PatientRecord,
  patientRelationship,
} from './patient.schema';
import { type ConsentView, displayName, type PatientDetail, toConsentView } from './patient.views';

const DEMOGRAPHIC_FIELDS = [
  'familyName',
  'givenName',
  'middleName',
  'suffix',
  'sex',
  'genderIdentity',
  'birthDate',
  'birthDateIsEstimated',
  'civilStatus',
  'nationality',
  'occupation',
] as const;

type SubRecord = 'contact' | 'address' | 'identifier' | 'relationship';

@Injectable()
export class PatientRecordService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Full registration record. Viewing is audited. */
  async getDetail(actor: Actor, patientId: string): Promise<PatientDetail> {
    const record = await this.findPatient(this.db, actor.organizationId, patientId);
    const [contacts, addresses, identifiers, relationships, consents, preferences] = await Promise.all([
      this.db
        .select()
        .from(patientContactPoint)
        .where(and(eq(patientContactPoint.patientId, patientId), eq(patientContactPoint.status, 'active'))),
      this.db
        .select()
        .from(patientAddress)
        .where(and(eq(patientAddress.patientId, patientId), eq(patientAddress.status, 'active'))),
      this.db
        .select()
        .from(patientIdentifier)
        .where(and(eq(patientIdentifier.patientId, patientId), eq(patientIdentifier.status, 'active'))),
      this.db
        .select()
        .from(patientRelationship)
        .where(and(eq(patientRelationship.patientId, patientId), eq(patientRelationship.status, 'active'))),
      this.currentConsents(patientId),
      this.db.select().from(patientCommunicationPreference).where(eq(patientCommunicationPreference.patientId, patientId)),
    ]);
    await this.audit.recordStandalone(actor, { action: 'patient.view', resourceType: 'patient', resourceId: patientId, patientId });
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
      registeredFacilityId: record.registeredFacilityId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      version: record.version,
      contacts: contacts.map(({ id, system, value, use, isPrimary }) => ({ id, system, value, use, isPrimary })),
      addresses: addresses.map(
        ({ organizationId: _o, patientId: _p, status: _s, createdBy: _c, retiredAt: _ra, retiredBy: _rb, ...address }) => address,
      ),
      identifiers: identifiers.map(({ id, type, value, issuer, validFrom, validUntil }) => ({
        id,
        type,
        value,
        issuer,
        validFrom,
        validUntil,
      })),
      relationships: relationships.map(
        ({ id, relationship, relatedPatientId, name, contactNumber, isEmergencyContact, isLegalGuardian, notes }) => ({
          id,
          relationship,
          relatedPatientId,
          name,
          contactNumber,
          isEmergencyContact,
          isLegalGuardian,
          notes,
        }),
      ),
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
      const nameChanged = 'familyName' in next || 'givenName' in next || 'middleName' in next;
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
      if (!updated) throw new NotFoundError('Patient');
      await this.audit.record(tx, actor, {
        action: 'patient.update-demographics',
        resourceType: 'patient',
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
      const deceasedAt = input.status === 'deceased' && input.deceasedAt ? new Date(input.deceasedAt) : null;
      const [updated] = await tx
        .update(patient)
        .set({ status: input.status, deceasedAt, updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
        .where(eq(patient.id, patientId))
        .returning();
      if (!updated) throw new NotFoundError('Patient');
      await this.audit.record(tx, actor, {
        action: 'patient.change-status',
        resourceType: 'patient',
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
            eq(patientContactPoint.status, 'active'),
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
          use: input.use ?? 'personal',
          isPrimary,
        })
        .returning();
      await this.auditSubRecord(tx, actor, patientId, 'contact', 'add', created?.id, { system: input.system, isPrimary });
      return created;
    });
  }

  async addAddress(actor: Actor, patientId: string, input: z.infer<typeof addressInput>) {
    return this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      const [existingPrimary] = await tx
        .select({ id: patientAddress.id })
        .from(patientAddress)
        .where(and(eq(patientAddress.patientId, patientId), eq(patientAddress.isPrimary, true), eq(patientAddress.status, 'active')));
      const isPrimary = input.isPrimary === true || !existingPrimary;
      if (isPrimary && existingPrimary)
        await tx.update(patientAddress).set({ isPrimary: false }).where(eq(patientAddress.id, existingPrimary.id));
      const [created] = await tx
        .insert(patientAddress)
        .values({ ...input, organizationId: actor.organizationId, patientId, createdBy: actor.userId, use: input.use ?? 'home', isPrimary })
        .returning();
      await this.auditSubRecord(tx, actor, patientId, 'address', 'add', created?.id, {
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
        await this.auditSubRecord(tx, actor, patientId, 'identifier', 'add', created?.id, { type: input.type, issuer: input.issuer });
        return created;
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new ConflictError('This identifier is already assigned to a patient', undefined, 'identifier_in_use');
      }
      throw error;
    }
  }

  async addRelationship(actor: Actor, patientId: string, input: z.infer<typeof relationshipInput>) {
    return this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      if (input.relatedPatientId) {
        if (input.relatedPatientId === patientId)
          throw new BusinessRuleError('A patient cannot be related to themselves', 'invalid_relationship');
        await this.findPatient(tx, actor.organizationId, input.relatedPatientId);
      }
      let contactNumberNormalized: string | undefined;
      if (input.contactNumber) {
        try {
          contactNumberNormalized = normalizeContact('mobile', input.contactNumber);
        } catch {
          contactNumberNormalized = input.contactNumber.replace(/[^\d+]/g, '');
        }
      }
      const [created] = await tx
        .insert(patientRelationship)
        .values({ ...input, contactNumberNormalized, organizationId: actor.organizationId, patientId, createdBy: actor.userId })
        .returning();
      await this.auditSubRecord(tx, actor, patientId, 'relationship', 'add', created?.id, {
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
        .set({ status: 'retired', retiredAt: new Date(), retiredBy: actor.userId, ...('isPrimary' in table ? { isPrimary: false } : {}) })
        .where(and(eq(table.id, recordId), eq(table.patientId, patientId), eq(table.status, 'active')))
        .returning({ id: table.id });
      if (retired.length === 0) throw new NotFoundError(capitalize(kind));
      await this.auditSubRecord(tx, actor, patientId, kind, 'retire', recordId, undefined, reason);
    });
  }

  async recordConsent(actor: Actor, patientId: string, input: z.infer<typeof recordConsentSchema>): Promise<ConsentView> {
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
      if (!created) throw new Error('Consent insert returned no row');
      await this.audit.record(tx, actor, {
        action: 'patient.consent-record',
        resourceType: 'patient_consent',
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
    const rows = await this.db
      .select()
      .from(patientConsent)
      .where(eq(patientConsent.patientId, patientId))
      .orderBy(desc(patientConsent.recordedAt));
    await this.audit.recordStandalone(actor, { action: 'patient.consent-view', resourceType: 'patient_consent', patientId });
    return rows.map(toConsentView);
  }

  async setCommunicationPreferences(actor: Actor, patientId: string, input: z.infer<typeof communicationPreferencesSchema>) {
    return this.db.transaction(async (tx) => {
      await this.assertMutable(tx, actor.organizationId, patientId);
      const before = await tx.select().from(patientCommunicationPreference).where(eq(patientCommunicationPreference.patientId, patientId));
      for (const pref of input.preferences) {
        await tx
          .insert(patientCommunicationPreference)
          .values({ organizationId: actor.organizationId, patientId, ...pref, updatedBy: actor.userId })
          .onConflictDoUpdate({
            target: [
              patientCommunicationPreference.patientId,
              patientCommunicationPreference.channel,
              patientCommunicationPreference.category,
            ],
            set: { optedIn: pref.optedIn, updatedAt: new Date(), updatedBy: actor.userId },
          });
      }
      const changes = Object.fromEntries(
        input.preferences.map((p) => {
          const previous = before.find((b) => b.channel === p.channel && b.category === p.category);
          return [`${p.channel}.${p.category}`, { from: previous?.optedIn ?? null, to: p.optedIn }];
        }),
      );
      await this.audit.record(tx, actor, {
        action: 'patient.communication-preferences',
        resourceType: 'patient',
        resourceId: patientId,
        patientId,
        changes,
      });
      return tx.select().from(patientCommunicationPreference).where(eq(patientCommunicationPreference.patientId, patientId));
    });
  }

  /** Destination and permission for contacting a patient (used by notifications). */
  async resolveContact(
    organizationId: string,
    patientId: string,
    channel: CommunicationChannel,
    category: CommunicationCategory,
  ): Promise<ContactResolution> {
    const [record] = await this.db
      .select({ status: patient.status })
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    if (!record) return { allowed: false, reason: 'patient_not_found' };
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
      .where(
        and(
          eq(patientContactPoint.patientId, patientId),
          eq(patientContactPoint.isPrimary, true),
          eq(patientContactPoint.status, 'active'),
        ),
      );
    return resolvePatientContact({
      status: record.status,
      channel,
      category,
      optedIn: preference?.optedIn,
      primaryMobile: primaries.find((c) => c.system === 'mobile')?.value,
      primaryEmail: primaries.find((c) => c.system === 'email')?.value,
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
    if (!row) throw new NotFoundError('Patient');
    return row;
  }

  private async assertMutable(tx: DbExecutor, organizationId: string, patientId: string): Promise<PatientRecord> {
    const [row] = await tx
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId), ne(patient.status, 'merged')))
      .for('update');
    if (!row) {
      await this.findPatient(tx, organizationId, patientId);
      throw new BusinessRuleError('This record was merged into another patient; update the surviving record instead', 'patient_merged');
    }
    return row;
  }

  private async lockForChange(tx: DbExecutor, organizationId: string, patientId: string, expectedVersion: number): Promise<PatientRecord> {
    const row = await this.assertMutable(tx, organizationId, patientId);
    if (row.version !== expectedVersion) throw new VersionConflictError('Patient', expectedVersion);
    return row;
  }

  private auditSubRecord(
    tx: DbExecutor,
    actor: Actor,
    patientId: string,
    kind: SubRecord,
    verb: 'add' | 'retire',
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
