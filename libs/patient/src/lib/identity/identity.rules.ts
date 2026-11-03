import { normalizeName, normalizePhMobile } from "@healthcare/core";

const PATIENT_NUMBER = /^P\d{1,10}$/i;

/** How a person at a self-service kiosk says who they are: a patient number or a mobile number. */
export type SelfServiceKey = { kind: "patient_number"; value: string } | { kind: "mobile"; value: string };

/** Interprets what was typed; null when it is neither a patient number nor a usable mobile number. */
export function selfServiceKey(raw: string): SelfServiceKey | null {
  const text = raw.trim();
  if (PATIENT_NUMBER.test(text)) return { kind: "patient_number", value: `P${text.slice(1).padStart(8, "0")}` };
  const digits = text.replace(/[\s().+-]/g, "");
  if (/^\d{7,15}$/.test(digits)) {
    const mobile = normalizePhMobile(text);
    return mobile ? { kind: "mobile", value: mobile } : null;
  }
  return null;
}

/** The given name as the Patient Master compares it: case, accents and spacing ignored. */
export const givenNameKey = (value: string) => normalizeName(value);

/** "Juan Dela Cruz" -> "J*** D*** C***": enough for a person to recognise themselves, nothing to read out to a bystander. */
export function maskedName(givenName: string, familyName: string): string {
  const mask = (word: string) => {
    const first = [...word.trim()][0];
    return first ? `${first.toUpperCase()}***` : "";
  };
  return [givenName, ...familyName.split(/\s+/)]
    .flatMap((word) => word.split(/\s+/))
    .map(mask)
    .filter(Boolean)
    .join(" ");
}
