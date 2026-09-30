import type { ReferralKind, ReferralStatus } from "../clinic.schema";

export type ReferralAction = "answer" | "link_appointment" | "complete" | "cancel";

/**
 * What a referral allows next (docs/domains/clinic.md, "Referrals"): an internal referral is accepted or declined by
 * the practitioner it names, may get an appointment while open, and is completed by them; an external one is completed
 * when the outside provider's reply is recorded. Either is cancelled while open. Declined, completed and cancelled are
 * final (also enforced by a database trigger).
 */
export function referralAllows(referral: { kind: ReferralKind; status: ReferralStatus }, action: ReferralAction): boolean {
  const open = referral.status === "sent" || referral.status === "accepted";
  switch (action) {
    case "answer":
      return referral.kind === "internal" && referral.status === "sent";
    case "link_appointment":
      return referral.kind === "internal" && open;
    case "complete":
      return referral.kind === "internal" ? referral.status === "accepted" : referral.status === "sent";
    case "cancel":
      return open;
  }
}

/** "RF00000042". */
export function referralNumber(value: number): string {
  return `RF${String(value).padStart(8, "0")}`;
}
