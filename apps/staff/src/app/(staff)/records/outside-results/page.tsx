import { ModulePage } from "@/components/module-page";
import { redirect } from "next/navigation";
import { InfoIcon } from "lucide-react";
import { Card, CardContent } from "@healthcare/ui/primitives";
import { SubmissionQueue } from "@/components/outside-results/submission-queue";
import { loadOutsideResultSubmissions } from "@/lib/api/outside-results";
import { can, getSession } from "@/lib/api/session";

export const metadata = { title: "Outside results sent by patients" };

/**
 * Results patients sent from MyHealth, oldest first. File one on the patient's record as an outside result (a clinician
 * then reviews it) or decline it with a reason the patient reads. Each listed patient's access is audited by the API.
 */
export default async function OutsideResultSubmissionsPage() {
  const session = await getSession();
  if (!can(session, "outside-result.submission.manage")) redirect("/");
  const items = (await loadOutsideResultSubmissions()) ?? [];
  return (
    <ModulePage
      title="Outside results sent by patients"
      description="Patients send reports from other laboratories and hospitals in MyHealth. Nothing is on their record until you file it."
    >
      <p className="flex items-start gap-2 text-table text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Open the report and read it. The system has not read it and does not know what it says. File it as an outside result, or decline it with a reason the
        patient can understand.
      </p>
      <Card>
        <CardContent className="pt-4">
          <SubmissionQueue items={items} />
        </CardContent>
      </Card>
    </ModulePage>
  );
}
