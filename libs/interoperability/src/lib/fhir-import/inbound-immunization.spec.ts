import type { ImportedImmunization } from "./inbound-model";
import { mapInboundEntries, toImmunizationInput } from "./inbound-mapping";
import { FhirImportError, parseImport } from "./inbound-validation";

type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: "#/definitions/Immunization" });

const patient = { resourceType: "Patient", id: "p1", name: [{ family: "Dela Cruz", given: ["Juan"] }], gender: "male", birthDate: "1980-03-04" };

const given = {
  resourceType: "Immunization",
  id: "im1",
  status: "completed",
  vaccineCode: { coding: [{ system: "http://example.org/their-codes", code: "X1", display: "Hepatitis B vaccine" }] },
  patient: { reference: "Patient/p1" },
  occurrenceDateTime: "2021-05-12T09:00:00+08:00",
  primarySource: true,
  manufacturer: { display: "Example Biologics" },
  lotNumber: "HB-778",
  expirationDate: "2022-01-31",
  site: { text: "Right deltoid" },
  route: { coding: [{ code: "IM", display: "Intramuscular" }] },
  doseQuantity: { value: 0.5, unit: "mL" },
  performer: [{ actor: { display: "Dr. Santos" } }],
  location: { display: "City Health Office" },
  protocolApplied: [{ doseNumberPositiveInt: 2 }],
};

const reported = {
  resourceType: "Immunization",
  id: "im2",
  status: "completed",
  vaccineCode: { text: "Measles-containing vaccine" },
  patient: { reference: "Patient/p1" },
  occurrenceString: "2019",
  primarySource: false,
  reportOrigin: { text: "Vaccination card" },
  protocolApplied: [{ doseNumberString: "Booster" }],
};

const notDone = {
  resourceType: "Immunization",
  id: "im3",
  status: "not-done",
  statusReason: { text: "Patient declined" },
  vaccineCode: { text: "Influenza vaccine" },
  patient: { reference: "Patient/p1" },
  occurrenceDateTime: "2025-10",
};

const unrecordable = { ...reported, id: "im4", occurrenceString: "childhood" };
const inError = { ...given, id: "im5", status: "entered-in-error" };

const bundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: [patient, given, reported, notDone, unrecordable, inError].map((resource) => ({ resource })),
};

describe("inbound Immunization", () => {
  it("holds the samples to the official R4 schema", () => {
    for (const r of [given, reported, notDone, unrecordable, inError]) expect(validate(r)).toBe(true);
  });

  const items = mapInboundEntries({}, parseImport(bundle)).slice(1) as ImportedImmunization[];
  const [g, r, n, u, e] = items as [ImportedImmunization, ImportedImmunization, ImportedImmunization, ImportedImmunization, ImportedImmunization];

  it("reads a dose given by the sender", () => {
    expect(g).toMatchObject({ kind: "immunization", acceptable: true, subject: "import_patient", vaccine: "Hepatitis B vaccine", doseNumber: "2" });
    expect(toImmunizationInput(g)).toEqual({
      vaccineName: "Hepatitis B vaccine",
      vaccineCodeSystem: "http://example.org/their-codes",
      vaccineCode: "X1",
      manufacturer: "Example Biologics",
      status: "completed",
      notDoneReasonText: null,
      occurrence: "2021-05-12T09:00:00+08:00",
      doseLabel: "2",
      doseNumber: 2,
      lotNumber: "HB-778",
      expiryDate: "2022-01-31",
      route: "Intramuscular",
      site: "Right deltoid",
      doseQuantity: 0.5,
      doseUnit: "mL",
      performerName: "Dr. Santos, City Health Office",
      sourceDescription: "Recorded by the sender",
    });
  });

  it("reads a reported dose with a year given as text, and where the information came from", () => {
    expect(r.acceptable).toBe(true);
    expect(r.notes.join(" ")).toMatch(/reported to them/);
    expect(toImmunizationInput(r)).toMatchObject({
      occurrence: "2019",
      doseLabel: "Booster",
      doseNumber: null,
      sourceDescription: "Reported to the sender (Vaccination card)",
    });
  });

  it("reads a dose not given with the sender's reason", () => {
    expect(n.acceptable).toBe(true);
    expect(toImmunizationInput(n)).toMatchObject({ status: "not_done", notDoneReasonText: "Patient declined", occurrence: "2025-10" });
  });

  it("cannot accept a date given only as words, or an entry the sender marks in error", () => {
    expect(u.acceptable).toBe(false);
    expect(u.occurrenceText).toBe("childhood");
    expect(e.acceptable).toBe(false);
  });

  it("refuses an Immunization without a vaccine code or with two occurrences", () => {
    const bad = (resource: object) => {
      try {
        parseImport(resource);
        return null;
      } catch (error) {
        return error instanceof FhirImportError ? error : null;
      }
    };
    const { vaccineCode: _vaccineCode, ...noVaccine } = given;
    expect(bad(noVaccine)?.status).toBe(400);
    expect(bad({ ...given, occurrenceString: "2021" })?.status).toBe(400);
    expect(bad({ ...given, protocolApplied: [{ series: "primary" }] })?.status).toBe(400);
  });
});
