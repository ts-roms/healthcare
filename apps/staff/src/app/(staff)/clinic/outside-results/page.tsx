import { ModulePage } from "@/components/module-page";
import { redirect } from "next/navigation";
import { InfoIcon } from "lucide-react";
import { Card, CardContent } from "@healthcare/ui/primitives";
import { UnreviewedOutsideResultList } from "@/components/outside-results/outside-results-panel";
import { loadUnreviewedOutsideResults } from "@/lib/api/outside-results";
import { can, getSession } from "@/lib/api/session";

export const metadata = { title: "Outside results awaiting review" };

/**
 * Reports from other laboratories and hospitals that no clinician has recorded reading yet, oldest first. Marking one as
 * reviewed records who read it and when; it says nothing about what the report shows. Each listed patient's access is
 * audited by the API.
 */
export default async function OutsideResultsToReviewPage() {
  const session = await getSession();
  if (!can(session, "outside-result.review")) redirect("/");
  const items = (await loadUnreviewedOutsideResults()) ?? [];
  return (
    <ModulePage title="Outside results awaiting review" description="Reports filed from other laboratories and hospitals that nobody has read yet.">
      <p className="flex items-start gap-2 text-table text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Open the report, read it, then mark it as reviewed. These are not results of this laboratory and the system has not read them.
      </p>
      <Card>
        <CardContent className="pt-4">
          <UnreviewedOutsideResultList items={items} />
        </CardContent>
      </Card>
    </ModulePage>
  );
}
