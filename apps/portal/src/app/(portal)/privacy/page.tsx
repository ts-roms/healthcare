import { ShieldCheckIcon } from "lucide-react";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalConsent } from "@/lib/api/types";
import { ConsentCard } from "./consent-card";

export const metadata = { title: "Privacy and consents" };

export default async function PrivacyPage() {
  const [{ timeZone, organization }, consents, dpo] = await Promise.all([
    getMe(),
    portalApi<PortalConsent[]>("/portal/consents"),
    // The clinic's Data Protection Officer as it names them (none set: the generic advice below).
    portalApi<{ dpoName: string | null; dpoContact: string | null }>("/portal/privacy").catch(() => ({ dpoName: null, dpoContact: null })),
  ]);
  // Consents never recorded and not offered online stay off the list: there is nothing to show, give or withdraw.
  const shown = consents.filter((c) => c.current || c.canGive);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Privacy and consents</h1>
        <p className="text-body text-muted-foreground">
          The consents you gave {organization.name}, and their history. You can withdraw some of them here; the others are changed with the clinic, which
          explains what it means for your care. Some consents you can give here, after reading the clinic&apos;s own words; the others you give at the clinic.
        </p>
      </div>
      {shown.length ? (
        <ul className="flex flex-col gap-3">
          {shown.map((c) => (
            <ConsentCard key={c.consentType} consent={c} timeZone={timeZone} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border bg-card p-4 text-body text-muted-foreground">No consents are recorded yet.</p>
      )}
      <p className="flex gap-2 text-body text-muted-foreground">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Withdrawing a consent applies from now on; it does not undo what was done before. Questions about your personal information?{" "}
        {dpo.dpoName || dpo.dpoContact ? (
          <span>
            Contact the clinic&apos;s data protection officer{dpo.dpoName ? `, ${dpo.dpoName}` : ""}
            {dpo.dpoContact ? `: ${dpo.dpoContact}` : ""}. You may ask for copies of your records, a correction, erasure or blocking, or object to a use of your
            data under <strong>Documents</strong>.
          </span>
        ) : (
          <span>
            Ask the clinic for its data protection officer. You may ask for copies of your records, a correction, erasure or blocking, or object to a use of
            your data under <strong>Documents</strong>.
          </span>
        )}
      </p>
    </div>
  );
}
