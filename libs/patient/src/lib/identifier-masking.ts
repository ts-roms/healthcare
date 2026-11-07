/**
 * Government and insurance identifiers (PhilHealth PIN, PhilSys, passport, licence, senior/PWD ID, HMO number) are shown
 * in full only to members who hold `patient.identifier.reveal`; everyone else with `patient.read` sees them masked
 * (docs/security-audit, VR-18). In-process consumers that need the real value (claim preparation, FHIR export) read it
 * through the services, not through these HTTP responses.
 */
export const IDENTIFIER_REVEAL_PERMISSION = "patient.identifier.reveal";

/** Masks an identifier to its last four digits, keeping separators: "12-345678901-2" → "••-••••••901-2". */
export function maskIdentifierValue(value: string, visible = 4): string {
  const digits = value.replace(/\D/g, "").length;
  let seenDigits = 0;
  return value.replace(/[0-9A-Za-z]/g, (c) => {
    if (!/\d/.test(c)) return "•";
    seenDigits += 1;
    return seenDigits > digits - visible ? c : "•";
  });
}

/** The same list with each value masked unless the caller may see it. */
export function withIdentifierMasking<T extends { value: string }>(identifiers: T[], reveal: boolean): T[] {
  return reveal ? identifiers : identifiers.map((identifier) => ({ ...identifier, value: maskIdentifierValue(identifier.value) }));
}
