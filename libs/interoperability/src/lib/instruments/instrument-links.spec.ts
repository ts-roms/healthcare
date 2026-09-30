import { ASTM, AstmLinkSession, hl7Ack, MllpDecoder, mllpFrame } from "./instrument-links";
import { parseAstmMessage } from "./instrument-messages";

const ORU = "MSH|^~\\&|ANALYZER|LAB-A|LIS|CLINIC|20260930101500||ORU^R01^ORU_R01|CTRL-0001|P|2.5.1\rOBR|1|2600000123\rOBX|1|NM|GLU^Glucose||6.1|mmol/L";

/** Encoded with python-astm (frame 1, checksum B3). */
const ASTM_FRAME = Buffer.from(
  "0231487c5c5e267c4d53472d37377c7c416e616c797a65725e312e300d507c310d4f7c317c323630303030303132337c52317c5e5e5e474c550d527c317c5e5e5e474c557c362e317c6d6d6f6c2f4c7c332e392d352e367c487c7c467c7c7c7c32303236303933303130313530300d527c327c5e5e5e43484f4c7c342e327c6d6d6f6c2f4c7c7c4e7c7c460d4c7c317c4e0d0342330d0a",
  "hex",
);

describe("instrument links", () => {
  it("reassembles MLLP messages split across TCP chunks", () => {
    const decoder = new MllpDecoder();
    const framed = Buffer.concat([mllpFrame(ORU), mllpFrame(ORU.replace("CTRL-0001", "CTRL-0002"))]);
    expect(decoder.push(framed.subarray(0, 20))).toEqual([]);
    const messages = decoder.push(framed.subarray(20));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(ORU);
    expect(messages[1]).toContain("CTRL-0002");
  });

  it("acknowledges with sender and receiver swapped and the original control id", () => {
    expect(hl7Ack(ORU, "AA", "ACK-1", "20260930101501")).toBe(
      "MSH|^~\\&|LIS|CLINIC|ANALYZER|LAB-A|20260930101501||ACK^R01^ACK|ACK-1|P|2.5.1\rMSA|AA|CTRL-0001",
    );
    expect(hl7Ack(ORU, "AE", "ACK-2", "20260930101502")).toContain("\rMSA|AE|CTRL-0001");
  });

  it("runs an ASTM E1381 session: ACK the enquiry and each good frame, hand over the transmission at EOT", () => {
    const session = new AstmLinkSession();
    const first = session.push(Buffer.from([ASTM.ENQ]));
    expect(first).toEqual({ replies: [ASTM.ACK], transmissions: [] });
    const framed = session.push(Buffer.concat([ASTM_FRAME, Buffer.from([ASTM.EOT])]));
    expect(framed.replies).toEqual([ASTM.ACK]);
    expect(framed.transmissions).toHaveLength(1);
    expect(parseAstmMessage(framed.transmissions[0]!, "O-3").results.map((r) => r.analyzerCode)).toEqual(["GLU", "CHOL"]);
  });

  it("answers NAK to a frame with a bad checksum and keeps only good frames", () => {
    const session = new AstmLinkSession();
    session.push(Buffer.from([ASTM.ENQ]));
    const corrupted = Buffer.from(ASTM_FRAME);
    corrupted[10] = 0x5a;
    const bad = session.push(corrupted);
    expect(bad.replies).toEqual([ASTM.NAK]);
    // The analyzer resends the frame; this time it is good.
    const resent = session.push(Buffer.concat([ASTM_FRAME, Buffer.from([ASTM.EOT])]));
    expect(resent.replies).toEqual([ASTM.ACK]);
    expect(resent.transmissions).toEqual([ASTM_FRAME.toString("latin1")]);
    // Frames outside an established session are refused.
    expect(new AstmLinkSession().push(ASTM_FRAME).replies).toEqual([ASTM.NAK]);
  });
});
