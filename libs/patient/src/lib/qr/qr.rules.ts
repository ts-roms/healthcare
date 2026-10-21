import { randomBytes } from "node:crypto";
import type { PatientQrContent } from "./qr.schema";

/** Version-tagged so a future payload format can be told apart from this one. */
export const QR_PREFIX = "HPQ1";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOKEN = /^[A-Z2-7]{26}$/;
const PATIENT_NUMBER = /^P\d{8,10}$/;
const MAX_PAYLOAD = 64;

/** 128 random bits as 26 base32 characters. */
export function generateQrToken(bytes: Buffer = randomBytes(16)): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out;
}

/**
 * The text encoded in the QR symbol. A `portal_link` is the MyHealth activation page with the key in the fragment, which
 * browsers never send to a server; it needs the portal's address.
 */
export function encodeQrPayload(content: PatientQrContent, token: string, patientNumber: string, portalBaseUrl?: string): string {
  if (content === "patient_number") return `${QR_PREFIX}:N:${patientNumber}`;
  if (content === "portal_link") {
    if (!portalBaseUrl) throw new Error("A portal link needs the portal address");
    return `${portalBaseUrl.replace(/\/+$/, "")}/activate#${QR_PREFIX}:T:${token}`;
  }
  return `${QR_PREFIX}:T:${token}`;
}

export type ParsedQr = { kind: "token"; token: string } | { kind: "patient_number"; patientNumber: string };

/** Reads what a scanner (or a hand-held scanner typing into a field) delivered; undefined when it is not ours. */
export function parseQrPayload(raw: string): ParsedQr | undefined {
  let text = raw.trim();
  // A portal link: only the fragment after "/activate#" is the key.
  const link = /^https?:\/\/[^\s#]{1,200}\/activate#(HPQ1:[^\s#]+)$/.exec(text);
  if (link?.[1]) text = link[1];
  if (text.length > MAX_PAYLOAD) return undefined;
  const [prefix, kind, value, ...rest] = text.split(":");
  if (prefix !== QR_PREFIX || rest.length > 0 || !value) return undefined;
  if (kind === "T" && TOKEN.test(value)) return { kind: "token", token: value };
  if (kind === "N" && PATIENT_NUMBER.test(value)) return { kind: "patient_number", patientNumber: value };
  return undefined;
}
