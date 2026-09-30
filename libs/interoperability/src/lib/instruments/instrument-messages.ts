/**
 * Analyzer result messages (docs/domains/laboratory-instruments.md): HL7 v2 ORU^R01 and ASTM E1394 (with E1381 framing),
 * read into the same neutral shape. Field positions follow the HL7 v2.5.1 segment definitions and the ASTM E1394
 * record layouts (as published in the open-source hl7apy and python-astm libraries). Nothing here interprets an
 * analyzer's flags or result status codes: they are kept as sent and shown to staff, who accept each value into the
 * laboratory's own result workflow (entry → verification → approval), where the laboratory's reference ranges flag it.
 */

export const INSTRUMENT_PROTOCOLS = ["hl7v2", "astm"] as const;
export type InstrumentProtocol = (typeof INSTRUMENT_PROTOCOLS)[number];

/** Where an analyzer puts the specimen's barcode (the platform's accession number). */
export const SPECIMEN_ID_FIELDS = {
  hl7v2: ["OBR-2", "OBR-3", "SPM-2"],
  astm: ["O-3", "O-4"],
} as const satisfies Record<InstrumentProtocol, readonly string[]>;
export type SpecimenIdField = (typeof SPECIMEN_ID_FIELDS)[InstrumentProtocol][number];

export function specimenFieldAllowed(protocol: InstrumentProtocol, field: string): field is SpecimenIdField {
  return (SPECIMEN_ID_FIELDS[protocol] as readonly string[]).includes(field);
}

export interface InstrumentMessageResult {
  /** 1-based position of the result in the message. */
  sequence: number;
  /** The specimen identifier as sent (null when the configured field is empty). */
  specimenCode: string | null;
  /** The analyzer's test code (null when absent). */
  analyzerCode: string | null;
  value: string;
  units: string | null;
  referenceRange: string | null;
  flags: string | null;
  status: string | null;
  /** The analyzer's own timestamp, as sent (its time zone is the analyzer's). */
  observedAt: string | null;
}

export interface InstrumentMessage {
  protocol: InstrumentProtocol;
  /** HL7 MSH-10 or ASTM H-3; repeated deliveries of one message carry the same id. */
  controlId: string | null;
  results: InstrumentMessageResult[];
}

export class InstrumentMessageError extends Error {
  constructor(
    readonly code: "not_hl7" | "not_astm" | "unsupported_message_type" | "checksum_mismatch" | "malformed_frame",
    message: string,
  ) {
    super(message);
  }
}

const clean = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, 200) : null;
};

// ---- HL7 v2 ------------------------------------------------------------------------------------------------------

/**
 * Reads an ORU^R01 message. Segments are separated by CR (LF and CRLF are tolerated). Delimiters come from MSH-1/MSH-2
 * (component, repetition, escape, subcomponent). Each OBX of an order (after its OBR, before any SPM of that order) is a
 * result; OBX segments inside the specimen group describe the specimen and are skipped. The specimen identifier comes
 * from OBR-2, OBR-3 (entity identifier) or the order's first SPM-2 (placer-assigned entity identifier); the test code
 * from OBX-3 (identifier, else alternate identifier); value OBX-5, units OBX-6, reference range OBX-7, abnormal flags
 * OBX-8, result status OBX-11, observation time OBX-14.
 */
export function parseHl7Message(text: string, specimenField: SpecimenIdField): InstrumentMessage {
  // MLLP start (VT) and end (FS) block characters may be left on by a gateway.
  // eslint-disable-next-line no-control-regex
  const content = text.replace(/^[\x0b\s]+/, "").replace(/[\x1c\s]+$/, "");
  const match = /^MSH(.)/.exec(content);
  if (!match) throw new InstrumentMessageError("not_hl7", "The message does not start with an MSH segment");
  const fieldSep = match[1]!;
  const segments = content.split(/\r\n|\r|\n/).filter((s) => s.trim().length > 0);
  const mshFields = segments[0]!.split(fieldSep);
  const encoding = mshFields[1] ?? "";
  if (encoding.length < 4) throw new InstrumentMessageError("not_hl7", "MSH-2 does not declare the encoding characters");
  const [componentSep, repetitionSep, , subcomponentSep] = encoding;
  // MSH-n is at index n-1 (MSH-1 is the field separator itself).
  const messageType = (mshFields[8] ?? "").split(componentSep!)[0];
  if (messageType !== "ORU") throw new InstrumentMessageError("unsupported_message_type", `Only ORU result messages are read (got ${messageType || "none"})`);
  const controlId = clean(mshFields[9]);

  const first = (field: string | undefined): string => (field ?? "").split(repetitionSep!)[0]!.split(componentSep!)[0]!.split(subcomponentSep!)[0]!;
  const component = (field: string | undefined, index: number): string =>
    ((field ?? "").split(repetitionSep!)[0]!.split(componentSep!)[index] ?? "").split(subcomponentSep!)[0]!;

  type Pending = Omit<InstrumentMessageResult, "sequence" | "specimenCode">;
  const orders: Array<{ obr: string[]; spm: string[] | null; results: Pending[] }> = [];
  for (const segment of segments.slice(1)) {
    const fields = segment.split(fieldSep);
    const name = fields[0];
    // SEG-n is at index n.
    if (name === "OBR") orders.push({ obr: fields, spm: null, results: [] });
    const order = orders.at(-1);
    if (!order) continue;
    if (name === "SPM" && !order.spm) order.spm = fields;
    if (name === "OBX" && !order.spm) {
      order.results.push({
        analyzerCode: clean(component(fields[3], 0)) ?? clean(component(fields[3], 3)),
        value: (fields[5] ?? "").trim().slice(0, 4000),
        units: clean(component(fields[6], 0)),
        referenceRange: clean(fields[7]),
        flags: clean(first(fields[8])),
        status: clean(fields[11]),
        observedAt: clean(component(fields[14], 0)),
      });
    }
  }
  let sequence = 0;
  const results: InstrumentMessageResult[] = [];
  for (const order of orders) {
    const specimenCode =
      specimenField === "OBR-2" ? clean(first(order.obr[2])) : specimenField === "OBR-3" ? clean(first(order.obr[3])) : clean(first(order.spm?.[2]));
    for (const result of order.results) results.push({ sequence: ++sequence, specimenCode, ...result });
  }
  return { protocol: "hl7v2", controlId, results };
}

// ---- ASTM E1381 / E1394 ------------------------------------------------------------------------------------------

const STX = "\x02";
const ETX = "\x03";

/** ASTM E1381 checksum: the byte sum, modulo 256, of the frame number through ETX/ETB, as two uppercase hex digits. */
export function astmChecksum(frame: string): string {
  let sum = 0;
  for (const byte of Buffer.from(frame, "latin1")) sum = (sum + byte) & 0xff;
  return sum.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Joins the records of an E1381 transmission: each frame is STX, frame number, text, ETB (intermediate) or CR ETX
 * (last of a record), two checksum characters, CR LF. Checksums are verified. Text without STX is taken as records
 * already unframed (separated by CR).
 */
export function astmRecords(text: string): string[] {
  // ENQ and EOT (E1381 establishment and termination) carry no data.
  // eslint-disable-next-line no-control-regex
  const body = text.replace(/[\x05\x04]/g, "");
  if (!body.includes(STX)) return body.split(/\r\n|\r|\n/).filter((r) => r.trim().length > 0);
  let joined = "";
  for (const raw of body.split(STX).slice(1)) {
    // ETX or ETB ends the frame text.
    // eslint-disable-next-line no-control-regex
    const end = raw.search(/[\x03\x17]/);
    if (end < 1) throw new InstrumentMessageError("malformed_frame", "An ASTM frame has no ETX or ETB");
    const frame = raw.slice(0, end + 1);
    const checksum = raw.slice(end + 1, end + 3);
    if (!/^[0-7]/.test(frame)) throw new InstrumentMessageError("malformed_frame", "An ASTM frame has no frame number");
    if (checksum.toUpperCase() !== astmChecksum(frame)) throw new InstrumentMessageError("checksum_mismatch", "An ASTM frame's checksum does not match");
    const data = frame.slice(1, -1);
    joined += frame.endsWith(ETX) ? `${data.replace(/\r$/, "")}\r` : data;
  }
  return joined.split("\r").filter((r) => r.trim().length > 0);
}

/**
 * Reads an ASTM E1394 message: the header (H) declares the delimiters (field, repeat, component, escape) and carries the
 * message control id (H-3); results (R) belong to the last order (O) before them. The specimen identifier is O-3
 * (specimen ID) or O-4 (instrument specimen ID); the test code is the Universal Test ID's local (fourth) component, else
 * its first non-empty one; value R-4, units R-5, reference ranges R-6, abnormal flags R-7, result status R-9, test
 * completed R-13.
 */
export function parseAstmMessage(text: string, specimenField: SpecimenIdField): InstrumentMessage {
  const records = astmRecords(text);
  const header = records.find((r) => r.startsWith("H"));
  if (!header || header.length < 5) throw new InstrumentMessageError("not_astm", "The message has no ASTM header record");
  const fieldSep = header[1]!;
  const repeatSep = header[2]!;
  const componentSep = header[3]!;
  const headerFields = header.split(fieldSep);
  const controlId = clean(headerFields[2]);
  const first = (field: string | undefined): string => (field ?? "").split(repeatSep)[0]!.split(componentSep)[0]!;

  let specimenCode: string | null = null;
  let sequence = 0;
  const results: InstrumentMessageResult[] = [];
  for (const record of records) {
    const fields = record.split(fieldSep);
    const type = fields[0];
    if (type === "O") specimenCode = clean(first(specimenField === "O-4" ? fields[3] : fields[2]));
    if (type !== "R") continue;
    const testComponents = (fields[2] ?? "").split(repeatSep)[0]!.split(componentSep);
    const analyzerCode = clean(testComponents[3]) ?? clean(testComponents.find((c) => c.trim().length > 0));
    results.push({
      sequence: ++sequence,
      specimenCode,
      analyzerCode,
      value: (fields[3] ?? "").trim().slice(0, 4000),
      units: clean(fields[4]),
      referenceRange: clean(fields[5]),
      flags: clean(fields[6]),
      status: clean(fields[8]),
      observedAt: clean(fields[12]),
    });
  }
  return { protocol: "astm", controlId, results };
}

export function parseInstrumentMessage(protocol: InstrumentProtocol, text: string, specimenField: SpecimenIdField): InstrumentMessage {
  return protocol === "hl7v2" ? parseHl7Message(text, specimenField) : parseAstmMessage(text, specimenField);
}
