import { redirect } from "next/navigation";
import { Card, CardContent } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { RecordsRequestSetting } from "@/lib/api/types";
import { ProcedureForm } from "./procedure-form";

export const metadata = { title: "Records request procedure" };

/** The organization's own procedure for patients' records requests; no deadline, fee or disclosure rule is built in. */
export default async function RecordsRequestSettingsPage() {
  const session = await getSession();
  if (!can(session, "patient.records-request.manage")) redirect("/");
  const setting = await api<RecordsRequestSetting>("/records-requests/setting");
  return (
    <>
      <PageHeader
        title="Records request procedure"
        description="Your organization's own response time, identity check and notice to patients, under its Data Privacy Act procedures."
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="rounded-md border border-dashed p-3 text-meta text-muted-foreground">
          The platform does not know the National Privacy Commission&apos;s requirements. Set these from your organization&apos;s own procedure, have your Data
          Protection Officer check them, and record the review under Admin → Compliance.
        </p>
        <Card>
          <CardContent className="py-4">
            <ProcedureForm setting={setting} canEdit={can(session, "organization.manage")} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
