/**
 * The key on a patient card with a MyHealth link: `<portal address>/activate#HPQ1:T:<26 characters>` (docs/domains/patient.md,
 * "Patient QR codes"). The key is the part after "#"; the app sends only that to the API, which says whether the clinic has an
 * open invitation for it. Anything else a camera reads is ignored.
 */
const CARD_LINK = /^https?:\/\/[^\s#]{1,200}\/activate#(HPQ1:T:[A-Z2-7]{26})$/;

export function cardKeyFromScan(scanned: string): string | null {
  return CARD_LINK.exec(scanned.trim())?.[1] ?? null;
}
