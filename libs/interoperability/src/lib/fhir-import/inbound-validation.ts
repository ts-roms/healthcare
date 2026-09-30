import { z } from "zod";
import { importKind } from "./inbound-model";

/**
 * Structural validation of inbound FHIR R4 content, targeted at what the platform reads.
 *
 * The official R4 JSON schema is used in tests only (a dev dependency with a large compiled schema); at runtime the
 * resource types we import are checked with these schemas, which follow the R4 (4.0.1) definitions for every element
 * the inbound mappers read: primitive formats (id, code, uri, date, dateTime, instant), required elements, cardinality
 * and required value-set bindings (e.g. Observation.status). Elements the platform does not read (extensions,
 * narrative, other elements) are kept in the sealed original but not interpreted, so they are not validated.
 * Unsupported resource types are only checked for a resourceType and a valid id. The unit tests hold samples to both
 * this validation and the official schema. See docs/interoperability/fhir.md ("Inbound").
 */

/** What one import may hold. The API's JSON body limit (1 MB) is the outer bound. */
export const IMPORT_LIMITS = { maxBytes: 512 * 1024, maxEntries: 100 } as const;

/** Bundle types accepted for review; transaction, batch and message imply processing semantics the platform does not offer. */
export const ACCEPTED_BUNDLE_TYPES = ["collection", "document", "searchset"] as const;
export type AcceptedBundleType = (typeof ACCEPTED_BUNDLE_TYPES)[number];
const ALL_BUNDLE_TYPES = [
  "document",
  "message",
  "transaction",
  "transaction-response",
  "batch",
  "batch-response",
  "history",
  "searchset",
  "collection",
] as const;

export type ImportIssueCode = "invalid" | "structure" | "required" | "value" | "not-supported" | "too-costly" | "conflict";
export interface ImportIssue {
  code: ImportIssueCode;
  diagnostics: string;
  /** FHIRPath-like location, e.g. "Bundle.entry[2].resource.status". */
  expression?: string;
}

/** A received import that cannot be taken; answered as an OperationOutcome with every issue found. */
export class FhirImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 413 | 422,
    readonly issues: ImportIssue[],
  ) {
    super(message);
    this.name = "FhirImportError";
  }
}

// ---- R4 primitives (regular expressions from the R4 specification) -----------------------------------------------

const YEAR = "([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)";
const TIME = "([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\\.[0-9]+)?";
const ZONE = "(Z|(\\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))";
const MONTH = "(0[1-9]|1[0-2])";
const DAY = "(0[1-9]|[1-2][0-9]|3[0-1])";

const str = z.string().regex(/^[ \r\n\t\S]+$/, "must not be empty");
const id = z.string().regex(/^[A-Za-z0-9\-.]{1,64}$/, "is not a valid FHIR id");
const code = z.string().regex(/^[^\s]+(\s[^\s]+)*$/, "is not a valid FHIR code");
const uri = z.string().regex(/^\S*$/, "is not a valid URI");
const date = z.string().regex(new RegExp(`^${YEAR}(-${MONTH}(-${DAY})?)?$`), "is not a valid FHIR date");
const dateTime = z.string().regex(new RegExp(`^${YEAR}(-${MONTH}(-${DAY}(T${TIME}${ZONE})?)?)?$`), "is not a valid FHIR dateTime");
const instant = z.string().regex(new RegExp(`^${YEAR}-${MONTH}-${DAY}T${TIME}${ZONE}$`), "is not a valid FHIR instant");
const unsignedInt = z.number().int().min(0);
const base64 = z.string().regex(/^(\s*([0-9a-zA-Z+=/]){4}\s*)+$/, "is not valid base64");

const obj = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);

const coding = obj({ system: uri.optional(), version: str.optional(), code: code.optional(), display: str.optional(), userSelected: z.boolean().optional() });
const codeableConcept = obj({ coding: z.array(coding).optional(), text: str.optional() });
const period = obj({ start: dateTime.optional(), end: dateTime.optional() });
const identifier = obj({
  use: z.enum(["usual", "official", "temp", "secondary", "old"]).optional(),
  type: codeableConcept.optional(),
  system: uri.optional(),
  value: str.optional(),
  period: period.optional(),
});
const reference = obj({ reference: str.optional(), type: uri.optional(), identifier: identifier.optional(), display: str.optional() });
const quantity = obj({
  value: z.number().optional(),
  comparator: z.enum(["<", "<=", ">=", ">"]).optional(),
  unit: str.optional(),
  system: uri.optional(),
  code: code.optional(),
});
const range = obj({ low: quantity.optional(), high: quantity.optional() });
const ratio = obj({ numerator: quantity.optional(), denominator: quantity.optional() });
const annotation = obj({ text: str });
const humanName = obj({
  use: z.enum(["usual", "official", "temp", "nickname", "anonymous", "old", "maiden"]).optional(),
  text: str.optional(),
  family: str.optional(),
  given: z.array(str).optional(),
  prefix: z.array(str).optional(),
  suffix: z.array(str).optional(),
  period: period.optional(),
});
const contactPoint = obj({
  system: z.enum(["phone", "fax", "email", "pager", "url", "sms", "other"]).optional(),
  value: str.optional(),
  use: z.enum(["home", "work", "temp", "old", "mobile"]).optional(),
  rank: z.number().int().positive().optional(),
  period: period.optional(),
});
const address = obj({
  use: z.enum(["home", "work", "temp", "old", "billing"]).optional(),
  type: z.enum(["postal", "physical", "both"]).optional(),
  text: str.optional(),
  line: z.array(str).optional(),
  city: str.optional(),
  district: str.optional(),
  state: str.optional(),
  postalCode: str.optional(),
  country: str.optional(),
  period: period.optional(),
});
const attachment = obj({
  contentType: code.optional(),
  language: code.optional(),
  data: base64.optional(),
  url: z.string().regex(/^\S+$/, "is not a valid URL").optional(),
  size: unsignedInt.optional(),
  hash: base64.optional(),
  title: str.optional(),
  creation: dateTime.optional(),
});
const dosage = obj({
  sequence: z.number().int().optional(),
  text: str.optional(),
  patientInstruction: str.optional(),
  asNeededBoolean: z.boolean().optional(),
});
const meta = obj({ versionId: id.optional(), lastUpdated: instant.optional(), source: uri.optional() });

const resourceBase = { id: id.optional(), meta: meta.optional() };

/** Exactly one of the value[x] (or other choice) elements may be present. */
function atMostOne(prefix: string, names: string[]) {
  return (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const present = names.filter((n) => value[n] !== undefined);
    if (present.length > 1) ctx.addIssue({ code: "custom", message: `only one of ${prefix}[x] may be present`, path: [present[1]!] });
  };
}

const patient = obj({
  resourceType: z.literal("Patient"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  active: z.boolean().optional(),
  name: z.array(humanName).optional(),
  telecom: z.array(contactPoint).optional(),
  gender: z.enum(["male", "female", "other", "unknown"]).optional(),
  birthDate: date.optional(),
  deceasedBoolean: z.boolean().optional(),
  deceasedDateTime: dateTime.optional(),
  address: z.array(address).optional(),
}).superRefine(atMostOne("deceased", ["deceasedBoolean", "deceasedDateTime"]));

const allergyIntolerance = obj({
  resourceType: z.literal("AllergyIntolerance"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  clinicalStatus: codeableConcept.optional(),
  verificationStatus: codeableConcept.optional(),
  type: z.enum(["allergy", "intolerance"]).optional(),
  category: z.array(z.enum(["food", "medication", "environment", "biologic"])).optional(),
  criticality: z.enum(["low", "high", "unable-to-assess"]).optional(),
  code: codeableConcept.optional(),
  patient: reference,
  onsetDateTime: dateTime.optional(),
  onsetString: str.optional(),
  recordedDate: dateTime.optional(),
  reaction: z
    .array(
      obj({
        substance: codeableConcept.optional(),
        manifestation: z.array(codeableConcept).min(1),
        description: str.optional(),
        onset: dateTime.optional(),
        severity: z.enum(["mild", "moderate", "severe"]).optional(),
      }),
    )
    .optional(),
  note: z.array(annotation).optional(),
}).superRefine(atMostOne("onset", ["onsetDateTime", "onsetString"]));

const condition = obj({
  resourceType: z.literal("Condition"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  clinicalStatus: codeableConcept.optional(),
  verificationStatus: codeableConcept.optional(),
  category: z.array(codeableConcept).optional(),
  severity: codeableConcept.optional(),
  code: codeableConcept.optional(),
  subject: reference,
  onsetDateTime: dateTime.optional(),
  onsetString: str.optional(),
  onsetPeriod: period.optional(),
  abatementDateTime: dateTime.optional(),
  abatementString: str.optional(),
  recordedDate: dateTime.optional(),
  note: z.array(annotation).optional(),
})
  .superRefine(atMostOne("onset", ["onsetDateTime", "onsetString", "onsetPeriod"]))
  .superRefine(atMostOne("abatement", ["abatementDateTime", "abatementString"]));

const OBSERVATION_VALUES = [
  "valueQuantity",
  "valueCodeableConcept",
  "valueString",
  "valueBoolean",
  "valueInteger",
  "valueRange",
  "valueRatio",
  "valueDateTime",
];
const observationValue = {
  valueQuantity: quantity.optional(),
  valueCodeableConcept: codeableConcept.optional(),
  valueString: str.optional(),
  valueBoolean: z.boolean().optional(),
  valueInteger: z.number().int().optional(),
  valueRange: range.optional(),
  valueRatio: ratio.optional(),
  valueDateTime: dateTime.optional(),
};
const observation = obj({
  resourceType: z.literal("Observation"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  status: z.enum(["registered", "preliminary", "final", "amended", "corrected", "cancelled", "entered-in-error", "unknown"]),
  category: z.array(codeableConcept).optional(),
  code: codeableConcept,
  subject: reference.optional(),
  effectiveDateTime: dateTime.optional(),
  effectivePeriod: period.optional(),
  effectiveInstant: instant.optional(),
  issued: instant.optional(),
  ...observationValue,
  interpretation: z.array(codeableConcept).optional(),
  referenceRange: z.array(obj({ low: quantity.optional(), high: quantity.optional(), text: str.optional() })).optional(),
  component: z
    .array(
      obj({ code: codeableConcept, ...observationValue, interpretation: z.array(codeableConcept).optional() }).superRefine(
        atMostOne("value", OBSERVATION_VALUES),
      ),
    )
    .optional(),
  note: z.array(annotation).optional(),
})
  .superRefine(atMostOne("value", OBSERVATION_VALUES))
  .superRefine(atMostOne("effective", ["effectiveDateTime", "effectivePeriod", "effectiveInstant"]));

/** medication[x] is required (1..1) on both medication resources. */
function oneMedication(value: { medicationCodeableConcept?: unknown; medicationReference?: unknown }, ctx: z.RefinementCtx) {
  const n = Number(value.medicationCodeableConcept !== undefined) + Number(value.medicationReference !== undefined);
  if (n !== 1)
    ctx.addIssue({ code: "custom", message: "exactly one of medicationCodeableConcept or medicationReference is required", path: ["medication[x]"] });
}

const medicationStatement = obj({
  resourceType: z.literal("MedicationStatement"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  status: z.enum(["active", "completed", "entered-in-error", "intended", "stopped", "on-hold", "unknown", "not-taken"]),
  medicationCodeableConcept: codeableConcept.optional(),
  medicationReference: reference.optional(),
  subject: reference,
  effectiveDateTime: dateTime.optional(),
  effectivePeriod: period.optional(),
  dateAsserted: dateTime.optional(),
  dosage: z.array(dosage).optional(),
  note: z.array(annotation).optional(),
})
  .superRefine(oneMedication)
  .superRefine(atMostOne("effective", ["effectiveDateTime", "effectivePeriod"]));

const medicationRequest = obj({
  resourceType: z.literal("MedicationRequest"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  status: z.enum(["active", "on-hold", "cancelled", "completed", "entered-in-error", "stopped", "draft", "unknown"]),
  intent: z.enum(["proposal", "plan", "order", "original-order", "reflex-order", "filler-order", "instance-order", "option"]),
  medicationCodeableConcept: codeableConcept.optional(),
  medicationReference: reference.optional(),
  subject: reference,
  authoredOn: dateTime.optional(),
  requester: reference.optional(),
  dosageInstruction: z.array(dosage).optional(),
  note: z.array(annotation).optional(),
}).superRefine(oneMedication);

const documentReference = obj({
  resourceType: z.literal("DocumentReference"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  status: z.enum(["current", "superseded", "entered-in-error"]),
  docStatus: z.enum(["preliminary", "final", "amended", "entered-in-error"]).optional(),
  type: codeableConcept.optional(),
  category: z.array(codeableConcept).optional(),
  subject: reference.optional(),
  date: instant.optional(),
  description: str.optional(),
  content: z.array(obj({ attachment, format: coding.optional() })).min(1),
});

const immunization = obj({
  resourceType: z.literal("Immunization"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  status: z.enum(["completed", "entered-in-error", "not-done"]),
  statusReason: codeableConcept.optional(),
  vaccineCode: codeableConcept,
  patient: reference,
  occurrenceDateTime: dateTime.optional(),
  occurrenceString: str.optional(),
  recorded: dateTime.optional(),
  primarySource: z.boolean().optional(),
  reportOrigin: codeableConcept.optional(),
  location: reference.optional(),
  manufacturer: reference.optional(),
  lotNumber: str.optional(),
  expirationDate: date.optional(),
  site: codeableConcept.optional(),
  route: codeableConcept.optional(),
  doseQuantity: quantity.optional(),
  performer: z.array(obj({ function: codeableConcept.optional(), actor: reference })).optional(),
  note: z.array(annotation).optional(),
  protocolApplied: z
    .array(
      obj({
        series: str.optional(),
        doseNumberPositiveInt: z.number().int().positive().optional(),
        doseNumberString: str.optional(),
        seriesDosesPositiveInt: z.number().int().positive().optional(),
        seriesDosesString: str.optional(),
      })
        .superRefine(atMostOne("doseNumber", ["doseNumberPositiveInt", "doseNumberString"]))
        .superRefine((value, ctx) => {
          if (value.doseNumberPositiveInt === undefined && value.doseNumberString === undefined) {
            ctx.addIssue({ code: "custom", message: "doseNumber[x] is required", path: ["doseNumber[x]"] });
          }
        }),
    )
    .optional(),
}).superRefine((value, ctx) => {
  const n = Number(value.occurrenceDateTime !== undefined) + Number(value.occurrenceString !== undefined);
  if (n !== 1) ctx.addIssue({ code: "custom", message: "exactly one of occurrenceDateTime or occurrenceString is required", path: ["occurrence[x]"] });
});

const age = quantity;

const procedure = obj({
  resourceType: z.literal("Procedure"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  status: z.enum(["preparation", "in-progress", "not-done", "on-hold", "stopped", "completed", "entered-in-error", "unknown"]),
  category: codeableConcept.optional(),
  code: codeableConcept.optional(),
  subject: reference,
  performedDateTime: dateTime.optional(),
  performedPeriod: period.optional(),
  performedString: str.optional(),
  performedAge: age.optional(),
  performedRange: range.optional(),
  recorder: reference.optional(),
  asserter: reference.optional(),
  performer: z.array(obj({ function: codeableConcept.optional(), actor: reference, onBehalfOf: reference.optional() })).optional(),
  location: reference.optional(),
  bodySite: z.array(codeableConcept).optional(),
  outcome: codeableConcept.optional(),
  note: z.array(annotation).optional(),
}).superRefine(atMostOne("performed", ["performedDateTime", "performedPeriod", "performedString", "performedAge", "performedRange"]));

const familyMemberHistory = obj({
  resourceType: z.literal("FamilyMemberHistory"),
  ...resourceBase,
  identifier: z.array(identifier).optional(),
  status: z.enum(["partial", "completed", "entered-in-error", "health-unknown"]),
  dataAbsentReason: codeableConcept.optional(),
  patient: reference,
  date: dateTime.optional(),
  name: str.optional(),
  relationship: codeableConcept,
  sex: codeableConcept.optional(),
  deceasedBoolean: z.boolean().optional(),
  deceasedAge: age.optional(),
  deceasedRange: range.optional(),
  deceasedDate: date.optional(),
  deceasedString: str.optional(),
  note: z.array(annotation).optional(),
  condition: z
    .array(
      obj({
        code: codeableConcept,
        outcome: codeableConcept.optional(),
        contributedToDeath: z.boolean().optional(),
        onsetAge: age.optional(),
        onsetRange: range.optional(),
        onsetPeriod: period.optional(),
        onsetString: str.optional(),
        note: z.array(annotation).optional(),
      }).superRefine(atMostOne("onset", ["onsetAge", "onsetRange", "onsetPeriod", "onsetString"])),
    )
    .optional(),
}).superRefine(atMostOne("deceased", ["deceasedBoolean", "deceasedAge", "deceasedRange", "deceasedDate", "deceasedString"]));

/** The inbound schema of each importable resource type (validated output types for the mappers). */
export const INBOUND_SCHEMAS = {
  Procedure: procedure,
  FamilyMemberHistory: familyMemberHistory,
  Patient: patient,
  AllergyIntolerance: allergyIntolerance,
  Condition: condition,
  Observation: observation,
  MedicationStatement: medicationStatement,
  MedicationRequest: medicationRequest,
  DocumentReference: documentReference,
  Immunization: immunization,
} as const;

export type InboundPatient = z.infer<typeof patient>;
export type InboundAllergy = z.infer<typeof allergyIntolerance>;
export type InboundCondition = z.infer<typeof condition>;
export type InboundObservation = z.infer<typeof observation>;
export type InboundMedicationStatement = z.infer<typeof medicationStatement>;
export type InboundMedicationRequest = z.infer<typeof medicationRequest>;
export type InboundDocumentReference = z.infer<typeof documentReference>;
export type InboundImmunization = z.infer<typeof immunization>;
export type InboundProcedure = z.infer<typeof procedure>;
export type InboundFamilyMemberHistory = z.infer<typeof familyMemberHistory>;
export type InboundCodeableConcept = z.infer<typeof codeableConcept>;
export type InboundReference = z.infer<typeof reference>;
export type InboundQuantity = z.infer<typeof quantity>;

const anyResource = obj({ resourceType: z.string().regex(/^[A-Z][A-Za-z]{1,63}$/, "is not a FHIR resource type"), id: id.optional() });

const bundle = obj({
  resourceType: z.literal("Bundle"),
  ...resourceBase,
  identifier: identifier.optional(),
  type: z.enum(ALL_BUNDLE_TYPES),
  timestamp: instant.optional(),
  total: unsignedInt.optional(),
  entry: z
    .array(
      obj({
        fullUrl: uri.optional(),
        resource: z.looseObject({}).optional(),
        search: obj({ mode: z.enum(["match", "include", "outcome"]).optional() }).optional(),
      }),
    )
    .optional(),
});

// ---- parsing ------------------------------------------------------------------------------------------------------

export interface ParsedEntry {
  index: number;
  fullUrl: string | null;
  resourceType: string;
  resource: Record<string, unknown> & { resourceType: string };
}

export interface ParsedImport {
  sourceKind: "bundle" | "resource";
  bundleType: AcceptedBundleType | null;
  /** Bundle.identifier (system and value) when present: may serve as the idempotency key. */
  bundleIdentifier: { system: string | null; value: string } | null;
  /** The source as declared (Bundle.meta.source, else the single resource's meta.source). */
  declaredSource: string | null;
  entries: ParsedEntry[];
}

function issuesOf(error: z.ZodError, prefix: string): ImportIssue[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("");
    const required = issue.code === "invalid_type" && issue.input === undefined;
    return {
      code: required ? "required" : issue.code === "invalid_value" || issue.code === "invalid_format" ? "value" : "structure",
      expression: `${prefix}${path}`,
      diagnostics: required ? `${prefix}${path} is required` : `${prefix}${path}: ${issue.message}`,
    };
  });
}

function validateResource(resource: Record<string, unknown>, prefix: string): ImportIssue[] {
  const base = anyResource.safeParse(resource, { reportInput: true });
  if (!base.success) return issuesOf(base.error, prefix);
  const schema = (INBOUND_SCHEMAS as Record<string, z.ZodType>)[base.data.resourceType];
  if (!schema) return [];
  const parsed = schema.safeParse(resource, { reportInput: true });
  return parsed.success ? [] : issuesOf(parsed.error, prefix);
}

/**
 * Checks a received body (a Bundle or a single resource) and splits it into entries. Throws FhirImportError with the
 * OperationOutcome issues when it cannot be taken for review.
 */
export function parseImport(body: unknown): ParsedImport {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FhirImportError("The body must be a FHIR R4 resource (JSON)", 400, [
      { code: "structure", diagnostics: "Expected a FHIR resource (JSON object)" },
    ]);
  }
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (bytes > IMPORT_LIMITS.maxBytes) {
    throw new FhirImportError("The import is too large", 413, [
      { code: "too-costly", diagnostics: `An import may hold at most ${IMPORT_LIMITS.maxBytes} bytes of JSON (this one: ${bytes})` },
    ]);
  }
  const root = body as Record<string, unknown>;
  const rootCheck = anyResource.safeParse(root, { reportInput: true });
  if (!rootCheck.success) throw new FhirImportError("Not a FHIR resource", 400, issuesOf(rootCheck.error, "$"));

  let parsed: Omit<ParsedImport, "entries"> & { raw: Array<{ fullUrl?: string; resource?: Record<string, unknown> }> };
  if (rootCheck.data.resourceType === "Bundle") {
    const result = bundle.safeParse(root, { reportInput: true });
    if (!result.success) throw new FhirImportError("The Bundle is not valid FHIR R4", 400, issuesOf(result.error, "Bundle"));
    const b = result.data;
    if (!(ACCEPTED_BUNDLE_TYPES as readonly string[]).includes(b.type)) {
      throw new FhirImportError(`Bundle type ${b.type} is not accepted`, 422, [
        {
          code: "not-supported",
          expression: "Bundle.type",
          diagnostics: `Bundle type "${b.type}" is not accepted: imports are reviewed by staff, never executed. Send a ${ACCEPTED_BUNDLE_TYPES.join(", ")} Bundle.`,
        },
      ]);
    }
    parsed = {
      sourceKind: "bundle",
      bundleType: b.type as AcceptedBundleType,
      bundleIdentifier: b.identifier?.value ? { system: b.identifier.system ?? null, value: b.identifier.value } : null,
      declaredSource: b.meta?.source ?? null,
      raw: (b.entry ?? []) as Array<{ fullUrl?: string; resource?: Record<string, unknown> }>,
    };
  } else {
    const resourceMeta = (root["meta"] ?? {}) as { source?: unknown };
    parsed = {
      sourceKind: "resource",
      bundleType: null,
      bundleIdentifier: null,
      declaredSource: typeof resourceMeta.source === "string" ? resourceMeta.source : null,
      raw: [{ resource: root }],
    };
  }

  if (parsed.raw.length === 0)
    throw new FhirImportError("The Bundle has no entries", 422, [
      { code: "required", expression: "Bundle.entry", diagnostics: "Nothing to import: the Bundle has no entries" },
    ]);
  if (parsed.raw.length > IMPORT_LIMITS.maxEntries) {
    throw new FhirImportError("Too many entries", 413, [
      {
        code: "too-costly",
        expression: "Bundle.entry",
        diagnostics: `An import may hold at most ${IMPORT_LIMITS.maxEntries} entries (this one: ${parsed.raw.length})`,
      },
    ]);
  }
  if (parsed.declaredSource && parsed.declaredSource.length > 200) {
    throw new FhirImportError("meta.source is too long", 422, [
      { code: "value", expression: "meta.source", diagnostics: "meta.source may be at most 200 characters" },
    ]);
  }

  const issues: ImportIssue[] = [];
  const entries: ParsedEntry[] = [];
  parsed.raw.forEach((entry, index) => {
    const prefix = parsed.sourceKind === "bundle" ? `Bundle.entry[${index}].resource` : String(root["resourceType"]);
    if (!entry.resource) {
      issues.push({ code: "required", expression: prefix, diagnostics: `${prefix} is required (entries without a resource cannot be imported)` });
      return;
    }
    const found = validateResource(entry.resource, prefix);
    issues.push(...found);
    if (found.length === 0) {
      const resource = entry.resource as ParsedEntry["resource"];
      entries.push({ index, fullUrl: entry.fullUrl ?? null, resourceType: resource.resourceType, resource });
    }
  });
  if (issues.length > 0) throw new FhirImportError("The content is not valid FHIR R4", 400, issues.slice(0, 50));

  const patients = entries.filter((e) => importKind(e.resourceType) === "patient");
  if (patients.length > 1) {
    throw new FhirImportError("More than one Patient", 422, [
      {
        code: "not-supported",
        diagnostics: `An import holds one patient's records; this one has ${patients.length} Patient resources. Send one Bundle per patient.`,
      },
    ]);
  }
  const { raw: _raw, ...rest } = parsed;
  return { ...rest, entries };
}
