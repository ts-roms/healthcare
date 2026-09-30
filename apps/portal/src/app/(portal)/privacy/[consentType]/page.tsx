import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { portalApi } from "@/lib/api/client";
import type { ConsentType, PortalConsentWording } from "@/lib/api/types";
import { CONSENT_TEXT } from "@/lib/consents";
import { GiveConsentForm } from "./give-consent-form";

export const metadata = { title: "Give consent" };

const GIVABLE: readonly string[] = ["telemedicine", "data_sharing_hmo", "data_sharing_philhealth", "research"];

/** The clinic's own wording of a consent, for the patient to read and — if they agree — give. Nothing is given by opening this page. */
export default async function GiveConsentPage({ params }: { params: Promise<{ consentType: string }> }) {
  const { consentType } = await params;
  if (!GIVABLE.includes(consentType)) notFound();
  let wording: PortalConsentWording;
  try {
    wording = await portalApi<PortalConsentWording>(`/portal/consents/${consentType}/wording`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="flex flex-col gap-5">
      <Link href="/privacy" className="inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" aria-hidden /> Privacy and consents
      </Link>
      <div>
        <p className="text-meta text-muted-foreground">{CONSENT_TEXT[consentType as ConsentType].title}</p>
        <h1 className="text-page-lg font-semibold">{wording.title}</h1>
      </div>
      <article className="rounded-xl border bg-card p-4 text-body whitespace-pre-line">{wording.body}</article>
      <GiveConsentForm consentType={consentType as ConsentType} wordingId={wording.id} acknowledgement={wording.acknowledgement} />
      <p className="text-meta text-muted-foreground">
        You can withdraw this consent later under Privacy and consents. Withdrawing applies from then on; it does not undo what was done before. Questions? Ask
        the clinic.
      </p>
    </div>
  );
}
