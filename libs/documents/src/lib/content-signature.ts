import type { ALLOWED_CONTENT_TYPES } from "./document.dto";

type ContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const ascii = (bytes: Uint8Array, from: number, to: number): string => Buffer.from(bytes.subarray(from, to)).toString("latin1");
const startsWith = (bytes: Uint8Array, signature: number[]): boolean => signature.every((value, index) => bytes[index] === value);
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * Whether the first bytes of a file are those of the format it was declared as (docs/security-audit, VR-14). A file whose
 * contents are something else is refused rather than stored under a type a viewer would trust. This is a signature check,
 * not validation of the whole file.
 */
export function matchesDeclaredType(bytes: Uint8Array, contentType: ContentType): boolean {
  switch (contentType) {
    case "application/pdf":
      return ascii(bytes, 0, 1024).includes("%PDF-");
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/tiff":
      return startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]);
    case "image/heic":
      return ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12));
    case "application/dicom":
      return ascii(bytes, 128, 132) === "DICM";
    default:
      return false;
  }
}
