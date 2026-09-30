import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge } from "@healthcare/ui/primitives";
import type { ReferralStatus } from "@/lib/api/types";
import { REFERRAL_STATUS, REFERRAL_URGENCY_LABEL } from "@/lib/clinic-mapping";
import { filedUnderText } from "@/lib/patient-merge";
import { ReferralOverdueBadge } from "./referral-overdue-badge";

export interface ReferralRow {
  id: string;
  referralNumber: string;
  status: ReferralStatus;
  urgency: "routine" | "urgent" | "emergency";
  recipient: string;
  specialty?: string | null;
  issuedAt: string;
  overdue: boolean;
  referringPractitionerName?: string | null;
  /** The patient number of a merged record it is filed under. */
  filedUnder?: string | null;
}

/** A patient's referrals as short rows (number, recipient, urgency, status): each opens the referral. No clinical text. */
export function ReferralList({ referrals, empty }: { referrals: ReferralRow[]; empty: string }) {
  if (referrals.length === 0) return <p className="text-table text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y text-table">
      {referrals.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
          <Link href={`/clinic/referrals/${r.id}`} className="font-medium text-primary hover:underline">
            {r.referralNumber}
          </Link>
          <span className="min-w-0 flex-1 text-meta text-muted-foreground">
            to {r.recipient}
            {r.specialty ? ` (${r.specialty})` : ""} · {clinicalDate(r.issuedAt)}
            {r.referringPractitionerName ? ` · by ${r.referringPractitionerName}` : ""}
            {r.filedUnder ? ` · ${filedUnderText(r.filedUnder)}` : ""}
          </span>
          {r.urgency !== "routine" ? (
            <Badge variant="warning">
              <AlertTriangleIcon aria-hidden /> {REFERRAL_URGENCY_LABEL[r.urgency]}
            </Badge>
          ) : null}
          <Badge variant={REFERRAL_STATUS[r.status].variant}>{REFERRAL_STATUS[r.status].label}</Badge>
          <ReferralOverdueBadge overdue={r.overdue} />
        </li>
      ))}
    </ul>
  );
}
