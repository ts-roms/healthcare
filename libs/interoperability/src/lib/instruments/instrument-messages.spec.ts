import { astmChecksum, astmRecords, InstrumentMessageError, parseAstmMessage, parseHl7Message, specimenFieldAllowed } from "./instrument-messages";

/** Built with the hl7apy library (HL7 v2.5.1 ORU^R01): two results, then a specimen group with its own OBX. */
const ORU =
  "MSH|^~\\&|ANALYZER||||20260930101500||ORU^R01^ORU_R01|CTRL-0001|P|2.5.1\rOBR|1|2600000123|FILLER-9|PANEL^Chemistry\r" +
  "OBX|1|NM|GLU^Glucose||6.1|mmol/L|3.9-5.6|H|||F|||20260930101500\rOBX|2|NM|^^^CHOL||4.2|mmol/L|||||F\r" +
  "SPM|1|SPM-2600000123\rOBX|1|ST|SPEC^Appearance||Clear";

/** Encoded with the python-astm library (E1381 frame 1 carrying E1394 records; checksum B3). */
const ASTM_FRAME = Buffer.from(
  "0231487c5c5e267c4d53472d37377c7c416e616c797a65725e312e300d507c310d4f7c317c323630303030303132337c52317c5e5e5e474c550d527c317c5e5e5e474c557c362e317c6d6d6f6c2f4c7c332e392d352e367c487c7c467c7c7c7c32303236303933303130313530300d527c327c5e5e5e43484f4c7c342e327c6d6d6f6c2f4c7c7c4e7c7c460d4c7c317c4e0d0342330d0a",
  "hex",
).toString("latin1");

describe("instrument messages", () => {
  it("reads an HL7 ORU^R01: results of each order, not the specimen's own observations", () => {
    const message = parseHl7Message(ORU, "OBR-2");
    expect(message.controlId).toBe("CTRL-0001");
    expect(message.results).toEqual([
      {
        sequence: 1,
        specimenCode: "2600000123",
        analyzerCode: "GLU",
        value: "6.1",
        units: "mmol/L",
        referenceRange: "3.9-5.6",
        flags: "H",
        status: "F",
        observedAt: "20260930101500",
      },
      expect.objectContaining({ sequence: 2, analyzerCode: "CHOL", value: "4.2", flags: null, status: "F" }),
    ]);
  });

  it("takes the specimen id from the configured HL7 field", () => {
    expect(parseHl7Message(ORU, "OBR-3").results[0]!.specimenCode).toBe("FILLER-9");
    expect(parseHl7Message(ORU, "SPM-2").results[0]!.specimenCode).toBe("SPM-2600000123");
    // LF-separated segments and MLLP start/end blocks are tolerated.
    expect(parseHl7Message(`\x0b${ORU.replace(/\r/g, "\n")}\x1c\r`, "OBR-2").results).toHaveLength(2);
  });

  it("refuses what is not an HL7 result message", () => {
    expect(() => parseHl7Message("PID|1", "OBR-2")).toThrow(InstrumentMessageError);
    try {
      parseHl7Message(ORU.replace("ORU^R01^ORU_R01", "ADT^A01"), "OBR-2");
    } catch (error) {
      expect((error as InstrumentMessageError).code).toBe("unsupported_message_type");
    }
  });

  it("agrees with python-astm's frame checksum and reads the records", () => {
    expect(astmChecksum(ASTM_FRAME.slice(1, ASTM_FRAME.indexOf("\x03") + 1))).toBe("B3");
    const message = parseAstmMessage(ASTM_FRAME, "O-3");
    expect(message.controlId).toBe("MSG-77");
    expect(message.results).toEqual([
      {
        sequence: 1,
        specimenCode: "2600000123",
        analyzerCode: "GLU",
        value: "6.1",
        units: "mmol/L",
        referenceRange: "3.9-5.6",
        flags: "H",
        status: "F",
        observedAt: "20260930101500",
      },
      expect.objectContaining({ sequence: 2, analyzerCode: "CHOL", value: "4.2", flags: "N", status: "F", observedAt: null }),
    ]);
    expect(parseAstmMessage(ASTM_FRAME, "O-4").results[0]!.specimenCode).toBe("R1");
  });

  it("joins intermediate (ETB) and last (ETX) frames and refuses a bad checksum", () => {
    const records = "H|\\^&|MSG-78\rO|1|2600000124\rR|1|^^^HGB|135|g/L||||F\rL|1|N";
    const frame = (n: number, text: string, end: "\x17" | "\x03") => {
      const body = `${n}${text}${end}`;
      return `\x02${body}${astmChecksum(body)}\r\n`;
    };
    const split = records.indexOf("R|1|") + 6;
    const transmission = `\x05${frame(1, records.slice(0, split), "\x17")}${frame(2, `${records.slice(split)}\r`, "\x03")}\x04`;
    expect(astmRecords(transmission)).toEqual(["H|\\^&|MSG-78", "O|1|2600000124", "R|1|^^^HGB|135|g/L||||F", "L|1|N"]);
    expect(parseAstmMessage(transmission, "O-3").results).toEqual([expect.objectContaining({ specimenCode: "2600000124", analyzerCode: "HGB", value: "135" })]);
    const corrupted = transmission.replace("HGB", "HGX");
    expect(() => astmRecords(corrupted)).toThrow(expect.objectContaining({ code: "checksum_mismatch" }));
    // Records already unframed by the gateway are read as they are.
    expect(parseAstmMessage(records, "O-3").results).toHaveLength(1);
    expect(() => parseAstmMessage("R|1|x", "O-3")).toThrow(expect.objectContaining({ code: "not_astm" }));
  });

  it("allows only the specimen fields of the protocol", () => {
    expect(specimenFieldAllowed("hl7v2", "SPM-2")).toBe(true);
    expect(specimenFieldAllowed("hl7v2", "O-3")).toBe(false);
    expect(specimenFieldAllowed("astm", "O-4")).toBe(true);
  });
});
