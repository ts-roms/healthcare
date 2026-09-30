import { Inject, Injectable } from "@nestjs/common";
import { ExternalRecordsService, ImmunizationService } from "@healthcare/clinic";
import { type Actor, DATABASE, type Database, type DbExecutor, NotFoundError } from "@healthcare/core";
import type {
  DuplicateOverride,
  ExternalHistoryInput,
  FhirImportTargets,
  ImportedAllergyInput,
  ImportedImmunizationInput,
  ImportOrigin,
  ImportPatientBrief,
  ImportPatientCandidate,
  RegistrationDraft,
} from "@healthcare/interoperability";
import {
  addressInput,
  contactPointInput,
  displayName,
  IDENTIFIER_TYPES,
  identifierInput,
  type IdentifierType,
  normalizeContact,
  PatientRecordService,
  PatientRegistrationService,
} from "@healthcare/patient";

function normalizable(c: { system: "mobile" | "phone" | "email"; value: string }): boolean {
  try {
    normalizeContact(c.system, c.value);
    return true;
  } catch {
    return false;
  }
}

function identifiers(draft: RegistrationDraft): Array<{ type: IdentifierType; value: string }> {
  return draft.identifiers.flatMap((i) =>
    (IDENTIFIER_TYPES as readonly string[]).includes(i.type) ? [{ type: i.type as IdentifierType, value: i.value }] : [],
  );
}

/**
 * FHIR imports → patient and clinic: patient lookup, duplicate detection and registration through the patient
 * domain; accepted allergies, immunizations and external history through the clinic domain's own commands (validation
 * and audit).
 */
@Injectable()
export class AppFhirImportTargets implements FhirImportTargets {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly patients: PatientRecordService,
    private readonly registration: PatientRegistrationService,
    private readonly external: ExternalRecordsService,
    private readonly immunizations: ImmunizationService,
  ) {}

  async patient(organizationId: string, patientId: string): Promise<ImportPatientBrief | undefined> {
    try {
      const p = await this.patients.findPatient(this.db, organizationId, patientId);
      return { id: p.id, patientNumber: p.patientNumber, displayName: displayName(p), sex: p.sex, birthDate: p.birthDate, status: p.status };
    } catch (error) {
      if (error instanceof NotFoundError) return undefined;
      throw error;
    }
  }

  async patientBriefs(organizationId: string, patientIds: string[]) {
    const briefs = await this.patients.briefs(organizationId, patientIds);
    return new Map([...briefs].map(([id, b]) => [id, { patientNumber: b.patientNumber, displayName: b.displayName }]));
  }

  /** Keeps what registration accepts: known identifier types, contacts and addresses that pass its validation. */
  refineDraft(draft: RegistrationDraft): RegistrationDraft | undefined {
    return {
      ...draft,
      contacts: draft.contacts.filter((c) => contactPointInput.safeParse(c).success && normalizable(c)),
      addresses: draft.addresses.filter((a) => addressInput.safeParse(a).success),
      identifiers: identifiers(draft).filter((i) => identifierInput.safeParse(i).success),
    };
  }

  async duplicateCandidates(actor: Actor, draft: RegistrationDraft): Promise<ImportPatientCandidate[]> {
    const candidates = await this.registration.checkDuplicates(actor, {
      familyName: draft.familyName,
      givenName: draft.givenName,
      birthDate: draft.birthDate,
      sex: draft.sex,
      contacts: draft.contacts,
      identifiers: identifiers(draft),
    });
    return candidates.map((c) => ({
      level: c.level,
      reasons: c.reasons,
      patient: {
        id: c.patient.id,
        patientNumber: c.patient.patientNumber,
        displayName: c.patient.displayName,
        sex: c.patient.sex,
        birthDate: c.patient.birthDate,
        status: c.patient.status,
      },
    }));
  }

  async registerPatient(actor: Actor, draft: RegistrationDraft, duplicateOverride?: DuplicateOverride): Promise<string> {
    const created = await this.registration.register(actor, {
      familyName: draft.familyName,
      givenName: draft.givenName,
      ...(draft.suffix ? { suffix: draft.suffix } : {}),
      sex: draft.sex,
      birthDate: draft.birthDate,
      contacts: draft.contacts,
      addresses: draft.addresses,
      identifiers: identifiers(draft),
      relationships: [],
      ...(duplicateOverride ? { duplicateOverride } : {}),
    });
    return created.id;
  }

  async recordAllergy(tx: DbExecutor, actor: Actor, patientId: string, input: ImportedAllergyInput, origin: ImportOrigin): Promise<string> {
    const allergy = await this.external.recordImportedAllergy(tx, actor, patientId, input, {
      reference: origin.reference,
      declaredSource: origin.declaredSource,
    });
    return allergy.id;
  }

  async recordImmunization(tx: DbExecutor, actor: Actor, patientId: string, input: ImportedImmunizationInput, origin: ImportOrigin): Promise<string> {
    const created = await this.immunizations.recordImportedIn(tx, actor, patientId, input, {
      reference: origin.reference,
      declaredSource: origin.declaredSource,
    });
    return created.id;
  }

  async recordExternalHistory(tx: DbExecutor, actor: Actor, patientId: string, input: ExternalHistoryInput, origin: ImportOrigin): Promise<string> {
    const entry = await this.external.recordExternalHistory(tx, actor, patientId, input, {
      reference: origin.reference,
      declaredSource: origin.declaredSource,
    });
    return entry.id;
  }
}
