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

/**
 * Whether a referral is overdue (docs/domains/clinic.md, "Referrals"): the organization may flag referrals still
 * waiting for the recipient — an internal one not yet accepted or declined, an external one whose reply has not been
 * recorded (status `sent`) — once `overdueAfterDays` days have passed since it was issued. Off (never overdue) while no
 * threshold is set: no deadline is assumed.
 */
export function referralOverdue(
  referral: { status: ReferralStatus; issuedAt: Date | string },
  overdueAfterDays: number | null,
  now: Date = new Date(),
): boolean {
  if (!overdueAfterDays || referral.status !== "sent") return false;
  return now.getTime() - new Date(referral.issuedAt).getTime() >= overdueAfterDays * 86_400_000;
}

/** The instant before which a `sent` referral is overdue, or null while the flag is off. */
export function overdueBefore(overdueAfterDays: number | null, now: Date = new Date()): Date | null {
  return overdueAfterDays ? new Date(now.getTime() - overdueAfterDays * 86_400_000) : null;
}
