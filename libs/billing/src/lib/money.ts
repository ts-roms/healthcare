/**
 * Money is integer centavos (PHP) end to end: stored as bigint, carried as a
 * JavaScript number (exact up to ₱90 trillion), never floating-point pesos.
 */

/** A percentage of an amount, in basis points (2000 = 20%), rounded half up to the centavo. */
export function percentOf(amountCentavos: number, rateBp: number): number {
  if (!Number.isSafeInteger(amountCentavos) || amountCentavos < 0) throw new RangeError("amount must be a non-negative integer of centavos");
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10_000) throw new RangeError("rate must be 0–10000 basis points");
  return Math.floor((amountCentavos * rateBp + 5_000) / 10_000);
}

/** "₱1,234.50" */
export function formatPeso(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100).toLocaleString("en-PH");
  return `${sign}₱${pesos}.${String(abs % 100).padStart(2, "0")}`;
}
