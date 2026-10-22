import { StaffSettingsPage } from "@/components/settings-page";
import { redirect } from "next/navigation";
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
    <StaffSettingsPage
      group="Security & privacy"
      title="Consent wording"
      description="The words patients read before they give some consents themselves in MyHealth."
      details={[
        "Patients can give some consents themselves in MyHealth, but only after reading your organization's own words.",
        "The platform provides no wording and does not say what a consent legally needs: have your data protection officer approve it.",
        "A consent is offered online only while its latest version says so.",
      ]}
    >
      {statuses.map((s) => (
        <ConsentWordingEditor key={`${s.consentType}:${s.current?.version ?? 0}`} status={s} />
      ))}
    </StaffSettingsPage>
  );
}
