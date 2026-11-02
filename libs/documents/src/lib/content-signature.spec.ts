import { matchesDeclaredType } from "./content-signature";

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string, offset = 0) => {
  const out = new Uint8Array(offset + value.length);
  out.set(Buffer.from(value, "latin1"), offset);
  return out;
};

describe("matchesDeclaredType", () => {
  it("accepts the signature of each declared format", () => {
    expect(matchesDeclaredType(text("%PDF-1.7\n"), "application/pdf")).toBe(true);
    expect(matchesDeclaredType(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(matchesDeclaredType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "image/png")).toBe(true);
    expect(matchesDeclaredType(bytes(0x49, 0x49, 0x2a, 0x00), "image/tiff")).toBe(true);
    expect(matchesDeclaredType(bytes(0x4d, 0x4d, 0x00, 0x2a), "image/tiff")).toBe(true);
    expect(matchesDeclaredType(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic")]), "image/heic")).toBe(true);
    expect(matchesDeclaredType(text("DICM", 128), "application/dicom")).toBe(true);
  });

  it("refuses a file that is something else than it was declared as", () => {
    expect(matchesDeclaredType(text("<html><script>alert(1)</script>"), "application/pdf")).toBe(false);
    expect(matchesDeclaredType(text("MZ executable"), "image/jpeg")).toBe(false);
    expect(matchesDeclaredType(text("%PDF-1.7"), "image/png")).toBe(false);
    expect(matchesDeclaredType(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypmp42")]), "image/heic")).toBe(false);
    expect(matchesDeclaredType(new Uint8Array(0), "application/dicom")).toBe(false);
  });
});
