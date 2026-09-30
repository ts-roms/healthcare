/**
 * Analyzer interfaces: the laboratory's vocabulary and its port to the interoperability layer, which reads HL7 v2 and
 * ASTM messages (libs/interoperability/src/lib/instruments). The laboratory never parses a wire format itself.
 */

export const INSTRUMENT_PROTOCOLS = ["hl7v2", "astm"] as const;
export type InstrumentProtocol = (typeof INSTRUMENT_PROTOCOLS)[number];

/** Where an analyzer puts the specimen's barcode (the platform's accession number), per protocol. */
export const SPECIMEN_ID_FIELDS = {
  hl7v2: ["OBR-2", "OBR-3", "SPM-2"],
  astm: ["O-3", "O-4"],
} as const satisfies Record<InstrumentProtocol, readonly string[]>;
export type SpecimenIdField = (typeof SPECIMEN_ID_FIELDS)[InstrumentProtocol][number];

/** One result of a message, as the analyzer sent it (flags and status codes are never interpreted). */
export interface InstrumentReadResult {
  sequence: number;
  specimenCode: string | null;
  analyzerCode: string | null;
  value: string;
  units: string | null;
  referenceRange: string | null;
  flags: string | null;
  status: string | null;
  observedAt: string | null;
}

export type InstrumentReadOutcome = { ok: true; controlId: string | null; results: InstrumentReadResult[] } | { ok: false; code: string; detail: string };

export interface InstrumentMessageReader {
  read(protocol: InstrumentProtocol, text: string, specimenField: SpecimenIdField): InstrumentReadOutcome;
}
export const INSTRUMENT_MESSAGE_READER = Symbol("INSTRUMENT_MESSAGE_READER");
