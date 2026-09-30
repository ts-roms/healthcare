import type { ImportedFamilyHistory, ImportedProcedure } from "./inbound-model";
import { mapInboundEntries, toFamilyHistoryInputs, toPastProcedureInput } from "./inbound-mapping";
import { FhirImportError, parseImport } from "./inbound-validation";

type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validators = new Map<string, Validate>();
function valid(resource: { resourceType: string }): boolean {
  let validate = validators.get(resource.resourceType);
  if (!validate) {
    validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: `#/definitions/${resource.resourceType}` });
    validators.set(resource.resourceType, validate);
  }
  return validate(resource);
}

const patient = { resourceType: "Patient", id: "p1", name: [{ family: "Dela Cruz", given: ["Juan"] }], gender: "male", birthDate: "1980-03-04" };

const appendectomy = {
  resourceType: "Procedure",
  id: "pr1",
  status: "completed",
  code: { coding: [{ system: "http://snomed.info/sct", code: "80146002", display: "Appendectomy" }] },
  subject: { reference: "Patient/p1" },
  performedDateTime: "2010-06-15T10:00:00+08:00",
  performer: [{ actor: { display: "Dr. Reyes" } }],
  location: { display: "Provincial Hospital" },
  bodySite: [{ text: "Abdomen" }],
};
const childhood = { ...appendectomy, id: "pr2", code: { text: "Tonsillectomy" }, performedDateTime: undefined, performedString: "as a child" };
const planned = { ...appendectomy, id: "pr3", status: "preparation" };

const father = {
  resourceType: "FamilyMemberHistory",
  id: "fm1",
  status: "completed",
  patient: { reference: "Patient/p1" },
  relationship: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: "FTH", display: "father" }] },
  deceasedBoolean: true,
  condition: [
    { code: { text: "Type 2 diabetes" }, onsetAge: { value: 45, unit: "years", system: "http://unitsofmeasure.org", code: "a" } },
    { code: { text: "Stroke" }, contributedToDeath: true },
  ],
};
const godmother = {
  resourceType: "FamilyMemberHistory",
  id: "fm2",
  status: "completed",
  patient: { reference: "Patient/p1" },
  relationship: { text: "Godmother" },
  condition: [{ code: { text: "Breast cancer" }, onsetString: "in her fifties" }],
};
const unknownHealth = {
  resourceType: "FamilyMemberHistory",
  id: "fm3",
  status: "health-unknown",
  patient: { reference: "Patient/p1" },
  relationship: { text: "Mother" },
};

const bundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: [patient, JSON.parse(JSON.stringify(childhood)), appendectomy, planned, father, godmother, unknownHealth].map((resource) => ({ resource })),
};

describe("inbound Procedure and FamilyMemberHistory", () => {
  it("holds the samples to the official R4 schema", () => {
    for (const r of [appendectomy, JSON.parse(JSON.stringify(childhood)), planned, father, godmother, unknownHealth]) expect(valid(r)).toBe(true);
  });

  const items = mapInboundEntries({}, parseImport(bundle)).slice(1);
  const [child, app, plan] = items as [ImportedProcedure, ImportedProcedure, ImportedProcedure];
  const [fth, god, unk] = items.slice(3) as [ImportedFamilyHistory, ImportedFamilyHistory, ImportedFamilyHistory];

  it("reads a procedure done elsewhere into a past procedure, keeping the date at the precision sent", () => {
    expect(app).toMatchObject({ kind: "procedure", acceptable: true, subject: "import_patient", display: "Appendectomy", performed: "2010-06-15" });
    expect(toPastProcedureInput(app)).toEqual({
      description: "Appendectomy",
      codeSystem: "http://snomed.info/sct",
      code: "80146002",
      performed: "2010-06-15",
      performer: "Dr. Reyes, Provincial Hospital",
      bodySite: "Abdomen",
      notes: null,
      sourceDescription: "Recorded by the sender",
    });
    expect(toPastProcedureInput(child)).toMatchObject({ performed: null, notes: "Date at the source: as a child" });
  });

  it("does not accept a procedure that was not done", () => {
    expect(plan.acceptable).toBe(false);
    expect(plan.notes.join(" ")).toMatch(/preparation/);
  });

  it("reads a relative's conditions into one family history entry each; a condition that contributed to death is the cause", () => {
    expect(fth).toMatchObject({ kind: "family_history", acceptable: true, relationship: "father", deceased: true });
    expect(toFamilyHistoryInputs(fth)).toEqual([
      {
        relationship: "father",
        relationshipText: null,
        condition: "Type 2 diabetes",
        codeSystem: null,
        code: null,
        onsetAge: 45,
        deceased: true,
        causeOfDeath: null,
        notes: null,
      },
      {
        relationship: "father",
        relationshipText: null,
        condition: "Stroke",
        codeSystem: null,
        code: null,
        onsetAge: null,
        deceased: true,
        causeOfDeath: "Stroke",
        notes: null,
      },
    ]);
  });

  it("keeps a relationship outside the list as written, and an onset given as words as a note", () => {
    expect(god.relationship).toBe("other");
    expect(toFamilyHistoryInputs(god)).toEqual([
      expect.objectContaining({
        relationship: "other",
        relationshipText: "Godmother",
        onsetAge: null,
        deceased: null,
        notes: "Onset at the source: in her fifties",
      }),
    ]);
  });

  it("does not accept a relative whose health is not known (that is a review)", () => {
    expect(unk.acceptable).toBe(false);
    expect(unk.notes.join(" ")).toMatch(/review/);
  });

  it("refuses a FamilyMemberHistory without a relationship or with two deceased values", () => {
    const bad = (resource: object) => {
      try {
        parseImport(resource);
        return null;
      } catch (error) {
        return error instanceof FhirImportError ? error : null;
      }
    };
    const { relationship: _relationship, ...noRelationship } = father;
    expect(bad(noRelationship)?.status).toBe(400);
    expect(bad({ ...father, deceasedDate: "2020" })?.status).toBe(400);
    expect(bad({ ...appendectomy, performedString: "2010" })?.status).toBe(400);
  });
});
