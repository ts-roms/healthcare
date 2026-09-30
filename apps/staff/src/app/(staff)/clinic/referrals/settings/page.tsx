import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { ReferralSettings } from "@/lib/api/types";
import { OverdueSetting } from "./overdue-setting";

export const metadata = { title: "Referral follow-up" };

/** The organization's referral settings: when an unanswered referral shows as overdue (off unless set). */
export default async function ReferralSettingsPage() {
  const session = await getSession();
  if (!can(session, "clinic.configure")) redirect("/clinic/referrals");
  const settings = await api<ReferralSettings>("/referrals/settings");
  return (
    <>
      <PageHeader title="Referral follow-up" description="For the whole organization. Changes are audited." />
      <div className="p-4">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Overdue referrals</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-table">
            <p className="text-muted-foreground">
              Flag referrals still awaiting an answer (from a practitioner here) or a reply (from an outside provider) a number of days after they were sent:
              they show as Overdue in the referral lists, on the referral and in the patient&apos;s Patient 360. No number is assumed — choose one that fits
              your organization&apos;s procedures. Nothing is sent to anyone automatically.
            </p>
            <OverdueSetting settings={settings} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
