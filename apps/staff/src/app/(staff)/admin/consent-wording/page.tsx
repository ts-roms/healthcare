import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { ConsentTextStatus } from "@/lib/api/types";
import { ConsentWordingEditor } from "./consent-wording-editor";

export const metadata = { title: "Consent wording" };

/** The organization's own consent wording for the consents patients may give in MyHealth. The platform ships none. */
export default async function ConsentWordingPage() {
  const session = await getSession();
  if (!can(session, "consent.wording.manage")) redirect("/");
  const statuses = await api<ConsentTextStatus[]>("/consent-texts");
  return (
    <>
      <PageHeader
        title="Consent wording"
        description="Patients can give some consents themselves in MyHealth, but only after reading your organization's own words. The platform provides no wording and does not say what a consent legally needs: have your data protection officer approve it. A consent is offered online only while its latest version says so."
      />
      <div className="flex flex-col gap-4 p-4">
        {statuses.map((s) => (
          <ConsentWordingEditor key={`${s.consentType}:${s.current?.version ?? 0}`} status={s} />
        ))}
      </div>
    </>
  );
}
