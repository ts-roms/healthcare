import { bigint, boolean, date, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const SEXES = ["male", "female", "intersex", "unknown"] as const;
export const CIVIL_STATUSES = ["single", "married", "widowed", "separated", "annulled", "unknown"] as const;
export const PATIENT_STATUSES = ["active", "inactive", "deceased", "merged"] as const;
export const IDENTIFIER_TYPES = [
  "philhealth_pin",
  "philsys_number",
  "senior_citizen_id",
  "pwd_id",
  "passport",
  "drivers_license",
  "hmo_member_id",
  "external_mrn",
  "other",
] as const;
export const CONTACT_SYSTEMS = ["mobile", "phone", "email"] as const;
export const CONTACT_USES = ["personal", "home", "work", "other"] as const;
export const ADDRESS_USES = ["home", "work", "temporary", "billing", "other"] as const;
export const RELATIONSHIPS = [
  "mother",
  "father",
  "parent",
  "spouse",
  "partner",
  "child",
  "sibling",
  "guardian",
  "grandparent",
  "grandchild",
  "relative",
  "friend",
  "employer",
  "other",
] as const;
export const CONSENT_TYPES = [
  "data_processing",
  "treatment_general",
  "telemedicine",
  "data_sharing_hmo",
  "data_sharing_philhealth",
  "portal_access",
  "research",
] as const;
export const CONSENT_DECISIONS = ["granted", "refused", "withdrawn"] as const;
export const CONSENT_CAPTURE = ["paper", "electronic", "verbal"] as const;
export const COMMUNICATION_CHANNELS = ["sms", "email", "push", "in_app"] as const;
export const COMMUNICATION_CATEGORIES = ["clinical", "administrative", "outreach"] as const;

export type Sex = (typeof SEXES)[number];
export type PatientStatus = (typeof PATIENT_STATUSES)[number];
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
export type ContactSystem = (typeof CONTACT_SYSTEMS)[number];
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];
export type CommunicationCategory = (typeof COMMUNICATION_CATEGORIES)[number];
type RecordStatus = "active" | "retired";

export const patientNumberSequence = pgTable("patient_number_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
});

export const patient = pgTable("patient", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientNumber: text("patient_number").notNull(),
  familyName: text("family_name").notNull(),
  givenName: text("given_name").notNull(),
  middleName: text("middle_name"),
  suffix: text("suffix"),
  familyNameNormalized: text("family_name_normalized").notNull(),
  givenNameNormalized: text("given_name_normalized").notNull(),
  nameSearch: text("name_search").notNull(),
  sex: text("sex").$type<Sex>().notNull(),
  genderIdentity: text("gender_identity"),
  birthDate: date("birth_date", { mode: "string" }).notNull(),
  birthDateIsEstimated: boolean("birth_date_is_estimated").notNull().default(false),
  civilStatus: text("civil_status").$type<(typeof CIVIL_STATUSES)[number]>(),
  nationality: text("nationality"),
  occupation: text("occupation"),
  status: text("status").$type<PatientStatus>().notNull().default("active"),
  deceasedAt: timestamp("deceased_at", { withTimezone: true }),
  mergedIntoPatientId: uuid("merged_into_patient_id"),
  registeredFacilityId: uuid("registered_facility_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const patientIdentifier = pgTable("patient_identifier", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  type: text("type").$type<IdentifierType>().notNull(),
  value: text("value").notNull(),
  valueNormalized: text("value_normalized").notNull(),
  issuer: text("issuer"),
  validFrom: date("valid_from", { mode: "string" }),
  validUntil: date("valid_until", { mode: "string" }),
  status: text("status").$type<RecordStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredBy: uuid("retired_by"),
});

export const patientContactPoint = pgTable("patient_contact_point", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  system: text("system").$type<ContactSystem>().notNull(),
  value: text("value").notNull(),
  valueNormalized: text("value_normalized").notNull(),
  use: text("use").$type<(typeof CONTACT_USES)[number]>().notNull().default("personal"),
  isPrimary: boolean("is_primary").notNull().default(false),
  status: text("status").$type<RecordStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredBy: uuid("retired_by"),
});

export const patientAddress = pgTable("patient_address", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  use: text("use").$type<(typeof ADDRESS_USES)[number]>().notNull().default("home"),
  line1: text("line1"),
  barangay: text("barangay"),
  cityMunicipality: text("city_municipality").notNull(),
  province: text("province"),
  region: text("region"),
  postalCode: text("postal_code"),
  country: text("country").notNull().default("PH"),
  psgcCode: text("psgc_code"),
  isPrimary: boolean("is_primary").notNull().default(false),
  status: text("status").$type<RecordStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredBy: uuid("retired_by"),
});

export const patientRelationship = pgTable("patient_relationship", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  relatedPatientId: uuid("related_patient_id"),
  relationship: text("relationship").$type<(typeof RELATIONSHIPS)[number]>().notNull(),
  name: text("name"),
  contactNumber: text("contact_number"),
  contactNumberNormalized: text("contact_number_normalized"),
  isEmergencyContact: boolean("is_emergency_contact").notNull().default(false),
  isLegalGuardian: boolean("is_legal_guardian").notNull().default(false),
  notes: text("notes"),
  status: text("status").$type<RecordStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredBy: uuid("retired_by"),
});

export const patientConsent = pgTable("patient_consent", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  consentType: text("consent_type").$type<(typeof CONSENT_TYPES)[number]>().notNull(),
  decision: text("decision").$type<(typeof CONSENT_DECISIONS)[number]>().notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  capturedVia: text("captured_via").$type<(typeof CONSENT_CAPTURE)[number]>().notNull(),
  documentId: uuid("document_id"),
  notes: text("notes"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const patientCommunicationPreference = pgTable(
  "patient_communication_preference",
  {
    organizationId: uuid("organization_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    channel: text("channel").$type<CommunicationChannel>().notNull(),
    category: text("category").$type<CommunicationCategory>().notNull(),
    optedIn: boolean("opted_in").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").notNull(),
  },
  (table) => [primaryKey({ columns: [table.patientId, table.channel, table.category] })],
);

export type PatientRecord = typeof patient.$inferSelect;
export type PatientIdentifierRecord = typeof patientIdentifier.$inferSelect;
export type PatientContactPointRecord = typeof patientContactPoint.$inferSelect;
export type PatientAddressRecord = typeof patientAddress.$inferSelect;
export type PatientRelationshipRecord = typeof patientRelationship.$inferSelect;
export type PatientConsentRecord = typeof patientConsent.$inferSelect;
