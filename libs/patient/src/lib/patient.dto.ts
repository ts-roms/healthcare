import { pageQuerySchema, todayInPhilippines } from '@healthcare/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ADDRESS_USES,
  CIVIL_STATUSES,
  COMMUNICATION_CATEGORIES,
  COMMUNICATION_CHANNELS,
  CONSENT_CAPTURE,
  CONSENT_DECISIONS,
  CONSENT_TYPES,
  CONTACT_SYSTEMS,
  CONTACT_USES,
  IDENTIFIER_TYPES,
  RELATIONSHIPS,
  SEXES,
} from './patient.schema';

const personName = z.string().trim().min(1).max(100);
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);

export const birthDateSchema = z.iso
  .date('Use YYYY-MM-DD')
  .refine((value) => value >= '1880-01-01', 'Birth date is too far in the past')
  .refine((value) => value <= todayInPhilippines(), 'Birth date cannot be in the future');

export const contactPointInput = z.object({
  system: z.enum(CONTACT_SYSTEMS),
  value: z.string().trim().min(3).max(254),
  use: z.enum(CONTACT_USES).optional(),
  isPrimary: z.boolean().optional(),
});

export const addressInput = z.object({
  use: z.enum(ADDRESS_USES).optional(),
  /** House/unit number, street, subdivision or sitio/purok. */
  line1: optionalText(300),
  barangay: optionalText(120),
  cityMunicipality: z.string().trim().min(1).max(120),
  province: optionalText(120),
  region: optionalText(120),
  postalCode: z
    .string()
    .regex(/^\d{4}$/, 'Philippine postal codes have 4 digits')
    .optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  psgcCode: z
    .string()
    .regex(/^\d{9,10}$/)
    .optional(),
  isPrimary: z.boolean().optional(),
});

export const identifierInput = z
  .object({
    type: z.enum(IDENTIFIER_TYPES),
    value: z.string().trim().min(1).max(64),
    /** Issuing body, required for HMO member IDs and external MRNs (e.g. the HMO or facility name). */
    issuer: optionalText(120),
    validFrom: z.iso.date().optional(),
    validUntil: z.iso.date().optional(),
  })
  .refine((v) => !['hmo_member_id', 'external_mrn'].includes(v.type) || v.issuer, {
    message: 'issuer is required for this identifier type',
    path: ['issuer'],
  })
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom, {
    message: 'validUntil must not precede validFrom',
    path: ['validUntil'],
  });

export const relationshipInput = z
  .object({
    relationship: z.enum(RELATIONSHIPS),
    relatedPatientId: z.string().uuid().optional(),
    name: optionalText(200),
    contactNumber: optionalText(40),
    isEmergencyContact: z.boolean().optional(),
    isLegalGuardian: z.boolean().optional(),
    notes: optionalText(500),
  })
  .refine((v) => v.relatedPatientId || v.name, { message: 'Provide relatedPatientId or name', path: ['name'] });

const demographics = z.object({
  familyName: personName,
  givenName: personName,
  middleName: optionalText(100),
  suffix: optionalText(20),
  sex: z.enum(SEXES),
  genderIdentity: optionalText(60),
  birthDate: birthDateSchema,
  birthDateIsEstimated: z.boolean().optional(),
  civilStatus: z.enum(CIVIL_STATUSES).optional(),
  nationality: z
    .string()
    .regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 code, e.g. PH')
    .optional(),
  occupation: optionalText(120),
});

export const duplicateCheckSchema = demographics
  .pick({ familyName: true, givenName: true, middleName: true, birthDate: true, sex: true })
  .extend({
    contacts: z.array(contactPointInput).max(10).optional(),
    identifiers: z.array(identifierInput).max(10).optional(),
  });
export class DuplicateCheckDto extends createZodDto(duplicateCheckSchema) {}

export const registerPatientSchema = demographics.extend({
  contacts: z.array(contactPointInput).max(10).default([]),
  addresses: z.array(addressInput).max(5).default([]),
  identifiers: z.array(identifierInput).max(10).default([]),
  relationships: z.array(relationshipInput).max(10).default([]),
  /**
   * When possible duplicates were shown to the user and they confirmed this is
   * a different person, send the reviewed candidate ids and a reason.
   */
  duplicateOverride: z.object({ reviewedCandidateIds: z.array(z.string().uuid()).min(1), reason }).optional(),
});
export class RegisterPatientDto extends createZodDto(registerPatientSchema) {}

export const updateDemographicsSchema = demographics.partial().extend({
  middleName: z.string().trim().max(100).nullable().optional(),
  suffix: z.string().trim().max(20).nullable().optional(),
  genderIdentity: z.string().trim().max(60).nullable().optional(),
  civilStatus: z.enum(CIVIL_STATUSES).nullable().optional(),
  nationality: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  occupation: z.string().trim().max(120).nullable().optional(),
  version: z.number().int().positive(),
  reason: reason.optional(),
});
export class UpdateDemographicsDto extends createZodDto(updateDemographicsSchema) {}

export const changeStatusSchema = z
  .object({
    status: z.enum(['active', 'inactive', 'deceased']),
    deceasedAt: z.iso.datetime({ offset: true }).optional(),
    reason,
    version: z.number().int().positive(),
  })
  .refine((v) => v.status !== 'deceased' || v.deceasedAt, { message: 'deceasedAt is required', path: ['deceasedAt'] });
export class ChangeStatusDto extends createZodDto(changeStatusSchema) {}

export class AddContactDto extends createZodDto(contactPointInput) {}
export class AddAddressDto extends createZodDto(addressInput) {}
export class AddIdentifierDto extends createZodDto(identifierInput) {}
export class AddRelationshipDto extends createZodDto(relationshipInput) {}

export const retireSchema = z.object({ reason });
export class RetireDto extends createZodDto(retireSchema) {}

export const recordConsentSchema = z
  .object({
    consentType: z.enum(CONSENT_TYPES),
    decision: z.enum(CONSENT_DECISIONS),
    capturedVia: z.enum(CONSENT_CAPTURE),
    effectiveAt: z.iso.datetime({ offset: true }).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    documentId: z.string().uuid().optional(),
    notes: optionalText(1000),
  })
  .refine((v) => !v.expiresAt || !v.effectiveAt || v.expiresAt > v.effectiveAt, {
    message: 'expiresAt must be after effectiveAt',
    path: ['expiresAt'],
  });
export class RecordConsentDto extends createZodDto(recordConsentSchema) {}

export const communicationPreferencesSchema = z.object({
  preferences: z
    .array(z.object({ channel: z.enum(COMMUNICATION_CHANNELS), category: z.enum(COMMUNICATION_CATEGORIES), optedIn: z.boolean() }))
    .min(1)
    .max(12),
});
export class CommunicationPreferencesDto extends createZodDto(communicationPreferencesSchema) {}

export const patientSearchSchema = pageQuerySchema
  .extend({
    /** Name, patient number or mobile number. */
    q: z.string().trim().min(2).max(100).optional(),
    birthDate: z.iso.date().optional(),
    identifierType: z.enum(IDENTIFIER_TYPES).optional(),
    identifierValue: z.string().trim().min(1).max(64).optional(),
    includeInactive: z.enum(['true', 'false']).optional(),
  })
  .refine((v) => v.q || v.birthDate || v.identifierValue, { message: 'Provide q, birthDate or identifierValue' })
  .refine((v) => !v.identifierValue || v.identifierType, {
    message: 'identifierType is required with identifierValue',
    path: ['identifierType'],
  });
export class PatientSearchDto extends createZodDto(patientSearchSchema) {}

export type RegisterPatientInput = z.infer<typeof registerPatientSchema>;
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;
export type PatientSearchInput = z.infer<typeof patientSearchSchema>;
