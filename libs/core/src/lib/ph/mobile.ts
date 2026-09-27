/**
 * Philippine mobile numbers are 10 national digits starting with 9
 * (written locally as 09XX XXX XXXX, internationally as +63 9XX XXX XXXX).
 * Returns the E.164 form, or undefined if the input is not a PH mobile number.
 */
export function normalizePhMobile(input: string): string | undefined {
  const digits = input.replace(/[^\d+]/g, "");
  const match = /^(?:\+?63|0)?(9\d{9})$/.exec(digits);
  return match ? `+63${match[1]}` : undefined;
}

/** "+639171234567" → "+63 9XX XXX 4567" style masking for display in lists. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "****";
  return `${local[0]}***@${domain}`;
}
