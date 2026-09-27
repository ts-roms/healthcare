import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge } from "@healthcare/ui/primitives";
import type { PatientConsent } from "@/lib/api/types";
import { consentState, type ConsentState, consentTypeLabel } from "@/lib/consent-form";
import { currentConsents } from "@/lib/patient-mapping";
import { SignedFormLink } from "./signed-form-link";

const STATE: Record<ConsentState, { text: string; variant: "success" | "warning" | "info" | "neutral" }> = {
  in_effect: { text: "Granted", variant: "success" },
  expired: { text: "Expired", variant: "warning" },
  not_yet_effective: { text: "Not yet in effect", variant: "info" },
  refused: { text: "Refused", variant: "neutral" },
  withdrawn: { text: "Withdrawn", variant: "warning" },
};

/** The latest decision per consent type. */
export function ConsentList({ consents, canViewDocuments }: { consents: PatientConsent[]; canViewDocuments: boolean }) {
  const current = currentConsents(consents);
  if (current.length === 0) return <p className="text-body text-muted-foreground">No consent recorded.</p>;
  return (
    <ul className="flex flex-col gap-1 text-body">
      {current.map((c) => {
        const state = STATE[consentState(c)];
        return (
          <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
            <Badge variant={state.variant}>{state.text}</Badge>
            <span>{consentTypeLabel(c.consentType)}</span>
            <span className="text-meta text-muted-foreground">
              {clinicalDate(c.effectiveAt)}
              {c.expiresAt ? ` · until ${clinicalDate(c.expiresAt)}` : ""}
            </span>
            {c.documentId && canViewDocuments ? <SignedFormLink documentId={c.documentId} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
