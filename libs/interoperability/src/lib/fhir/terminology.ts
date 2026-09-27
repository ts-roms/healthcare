/**
 * Code systems and value sets used by the mapping, all from published FHIR R4
 * (4.0.1) or the named terminologies. Nothing here is a Philippine government
 * system: national identifier systems (PhilHealth PIN, PhilSys number, PRC
 * license) have no official URI on record yet and are configured through
 * `FhirContext.identifierSystems` (see docs/interoperability/fhir.md).
 */
export const FHIR_VERSION = "4.0.1";

export const SYSTEMS = {
  loinc: "http://loinc.org",
  snomed: "http://snomed.info/sct",
  icd10: "http://hl7.org/fhir/sid/icd-10",
  ucum: "http://unitsofmeasure.org",
  v2IdentifierType: "http://terminology.hl7.org/CodeSystem/v2-0203",
  v2DiagnosticService: "http://terminology.hl7.org/CodeSystem/v2-0074",
  v3ActCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  v3Interpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  observationCategory: "http://terminology.hl7.org/CodeSystem/observation-category",
  conditionCategory: "http://terminology.hl7.org/CodeSystem/condition-category",
  conditionClinical: "http://terminology.hl7.org/CodeSystem/condition-clinical",
  conditionVerification: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
  allergyClinical: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
  allergyVerification: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
  diagnosisRole: "http://terminology.hl7.org/CodeSystem/diagnosis-role",
  iso3166: "urn:iso:std:iso:3166",
} as const;

/** Vital signs as in the FHIR R4 vital signs profile (LOINC code, display, UCUM unit). */
export const VITAL_SIGNS = {
  panel: { code: "85353-1", display: "Vital signs, weight, height, head circumference, oxygen saturation and BMI panel" },
  bloodPressure: { code: "85354-9", display: "Blood pressure panel with all children optional" },
  systolic: { code: "8480-6", display: "Systolic blood pressure", unit: "mm[Hg]", human: "mmHg" },
  diastolic: { code: "8462-4", display: "Diastolic blood pressure", unit: "mm[Hg]", human: "mmHg" },
  heartRate: { code: "8867-4", display: "Heart rate", unit: "/min", human: "beats/minute" },
  respiratoryRate: { code: "9279-1", display: "Respiratory rate", unit: "/min", human: "breaths/minute" },
  temperature: { code: "8310-5", display: "Body temperature", unit: "Cel", human: "C" },
  oxygenSaturation: { code: "2708-6", display: "Oxygen saturation in Arterial blood", unit: "%", human: "%" },
  weight: { code: "29463-7", display: "Body weight", unit: "kg", human: "kg" },
  height: { code: "8302-2", display: "Body height", unit: "cm", human: "cm" },
  bmi: { code: "39156-5", display: "Body mass index (BMI) [Ratio]", unit: "kg/m2", human: "kg/m2" },
} as const;

/** LOINC "Laboratory report" (document type for a DiagnosticReport of a laboratory order). */
export const LAB_REPORT_CODE = { system: SYSTEMS.loinc, code: "11502-2", display: "Laboratory report" } as const;

/** SNOMED CT "No known allergy (situation)", the usual way to state a recorded no-known-allergies review. */
export const NO_KNOWN_ALLERGY = { system: SYSTEMS.snomed, code: "716186003", display: "No known allergy (situation)" } as const;
