import { encodeQrPayload, generateQrToken, parseQrPayload } from "./qr.rules";

describe("patient QR payloads", () => {
  it("generates 26 base32 characters that differ each time", () => {
    const a = generateQrToken();
    expect(a).toMatch(/^[A-Z2-7]{26}$/);
    expect(generateQrToken()).not.toBe(a);
    expect(generateQrToken(Buffer.alloc(16))).toBe("A".repeat(26));
    expect(generateQrToken(Buffer.alloc(16, 255))).toMatch(/^7{25}4$/);
  });

  it("round-trips both contents and carries nothing but the key", () => {
    const token = generateQrToken();
    expect(parseQrPayload(encodeQrPayload("token", token, "P00000012"))).toEqual({ kind: "token", token });
    const number = encodeQrPayload("patient_number", token, "P00000012");
    expect(number).toBe("HPQ1:N:P00000012");
    expect(parseQrPayload(` ${number}\n`)).toEqual({ kind: "patient_number", patientNumber: "P00000012" });
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      "P00000012",
      "HPQ1",
      "HPQ1:T:short",
      "HPQ1:X:P00000012",
      "HPQ2:T:" + "A".repeat(26),
      "HPQ1:T:" + "a".repeat(26),
      `HPQ1:T:${"A".repeat(26)}:x`,
      "HPQ1:N:" + "9".repeat(80),
    ]) {
      expect(parseQrPayload(bad)).toBeUndefined();
    }
  });
});
