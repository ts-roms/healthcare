import { toClinicProcedure } from "./procedures";
import type { ClinicProcedureSource, FhirContext } from "./sources";

type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validateProcedure = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: "#/definitions/Procedure" });

const ctx: FhirContext = {
  baseUrl: "https://api.example.ph/api/v1/fhir/r4",
  identifierBase: "https://ids.example.ph/demo",
  organization: { id: "0b9f0f6e-0000-4000-8000-000000000001", code: "demo", name: "Demo Health" },
  codeSystems: { rvs: "https://codes.example.org/rvs" },
};
const P = "9e121d11-9636-4505-836b-66d13ba58f5e";

const suture: ClinicProcedureSource = {
  id: "c1000000-0000-4000-8000-000000000001",
  encounterId: "11111111-1111-4111-8111-111111111111",
  facilityId: "ecd2e1c3-74a3-41dd-b5c0-63a2f0499422",
  code: "SUT-S",
  name: "Suture repair, simple",
  codeSystem: "rvs",
  externalCode: "12001",
  performedAt: "2026-09-30T02:15:00.000Z",
  performerPractitionerId: "3499fee7-72e1-45e3-b25f-18a73144e638",
  bodySite: "left forearm",
  quantity: 2,
  recordedAt: "2026-09-30T02:20:00.000Z",
  enteredInErrorAt: null,
};

describe("clinic procedures (FHIR)", () => {
  it("maps a procedure performed at the clinic to a valid Procedure with the organization's code", () => {
    const resource = toClinicProcedure(ctx, P, suture);
    expect(validateProcedure(resource) ? [] : validateProcedure.errors).toEqual([]);
    expect(resource).toMatchObject({
      status: "completed",
      meta: { lastUpdated: suture.recordedAt },
      category: { coding: [{ system: "https://ids.example.ph/demo/codesystem/procedure-category", code: "clinic-procedure" }] },
      code: {
        text: "Suture repair, simple",
        coding: [
          { system: "https://ids.example.ph/demo/codesystem/clinic-procedure", code: "SUT-S" },
          { system: "https://codes.example.org/rvs", code: "12001" },
        ],
      },
      encounter: { reference: `Encounter/${suture.encounterId}` },
      performer: [{ actor: { reference: `Practitioner/${suture.performerPractitionerId}` } }],
      bodySite: [{ text: "left forearm" }],
      note: [{ text: "Quantity: 2" }],
    });
  });

  it("marks one entered in error, last updated when it was marked", () => {
    const resource = toClinicProcedure(ctx, P, {
      ...suture,
      quantity: 1,
      bodySite: null,
      codeSystem: null,
      externalCode: null,
      enteredInErrorAt: "2026-09-30T03:00:00.000Z",
    });
    expect(validateProcedure(resource) ? [] : validateProcedure.errors).toEqual([]);
    expect(resource).toMatchObject({ status: "entered-in-error", meta: { lastUpdated: "2026-09-30T03:00:00.000Z" } });
    expect(resource.code?.coding).toHaveLength(1);
    expect(resource).not.toHaveProperty("note");
    expect(resource).not.toHaveProperty("bodySite");
  });

  it("leaves out the encounter for a procedure performed under a queue visit without a consultation", () => {
    const resource = toClinicProcedure(ctx, P, { ...suture, encounterId: null });
    expect(validateProcedure(resource) ? [] : validateProcedure.errors).toEqual([]);
    expect(resource).not.toHaveProperty("encounter");
    expect(resource.performer).toHaveLength(1);
  });
});
