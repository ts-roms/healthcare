import type { InstrumentMatchProblem, InstrumentProtocol } from "./api/types";

/** Why an analyzer result could not be matched, and what to do about it. */
export const MATCH_PROBLEM: Record<InstrumentMatchProblem, string> = {
  no_specimen_id: "No specimen id in the message — check where the instrument sends the barcode.",
  unknown_specimen: "No specimen with this accession number at this facility.",
  no_test_code: "No test code in the message.",
  unmapped_code: "This analyzer code is not mapped to a test — map it on the instrument's interface.",
  test_not_ordered: "This test is not ordered on the specimen.",
};

export const PROTOCOL_LABEL: Record<InstrumentProtocol, string> = { hl7v2: "HL7 v2 (ORU^R01)", astm: "ASTM E1394 / E1381" };

/** Where each protocol can carry the specimen's barcode. */
export const SPECIMEN_FIELDS: Record<InstrumentProtocol, Array<{ value: string; label: string }>> = {
  hl7v2: [
    { value: "OBR-2", label: "OBR-2 — placer order number" },
    { value: "OBR-3", label: "OBR-3 — filler order number" },
    { value: "SPM-2", label: "SPM-2 — specimen id" },
  ],
  astm: [
    { value: "O-3", label: "O-3 — specimen id" },
    { value: "O-4", label: "O-4 — instrument specimen id" },
  ],
};

/** "6.1 mmol/L" */
export function sentValue(row: { value: string; units: string | null }): string {
  return row.units ? `${row.value} ${row.units}` : row.value;
}
