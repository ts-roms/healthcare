import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, ClockIcon } from "lucide-react";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { StaffSettingsPage } from "@/components/settings-page";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { AssistantInsights } from "@/lib/api/types";
import { dismissedShare, insightsOrder, reviewSummary, whereOn } from "@/lib/assistant-settings";

export const metadata = { title: "Assistant insights" };

const PERIODS = [30, 90, 365] as const;

/** How each rule's suggestions were used, and the organization's reviews of its rules (docs/runbooks/assistant-rule-review.md). */
export default async function AssistantInsightsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "assistant.insights.read")) redirect("/");
  const days = PERIODS.find((d) => String(d) === params.days) ?? 90;
  const insights = await api<AssistantInsights>("/assistant/insights", { query: { days } });
  const rules = insightsOrder(insights.rules);
  const due = rules.filter((r) => r.reviewDue).length;
  return (
    <StaffSettingsPage
      group="Organization"
      title="Assistant insights"
      description="How each rule's suggestions were used, and your reviews of the rules."
      details={[
        "Shown counts every time a suggestion appeared on a screen; followed counts its link being opened. Dismissed counts both answers, Dismiss and Not useful, with the reasons staff chose to give.",
        "Review each rule turned on about every three months: keep it, adjust its thresholds, or retire it. A rule is due for review when it is on and was never reviewed, was reviewed over 92 days ago, or was reviewed on an earlier version.",
        "Counts and staff's own words only: no patient or finding is shown here.",
      ]}
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/assistant">Rule settings</Link>
        </Button>
      }
    >
      <nav aria-label="Period" className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-meta text-muted-foreground">Last:</span>
        {PERIODS.map((d) => (
          <Button key={d} asChild size="sm" variant={d === days ? "secondary" : "ghost"}>
            <Link href={`/admin/assistant/insights?days=${d}`} aria-current={d === days ? "page" : undefined}>
              {d} days
            </Link>
          </Button>
        ))}
      </nav>
      <p className="text-body">{due === 0 ? "No rule is due for review." : `${due} ${due === 1 ? "rule is" : "rules are"} due for review.`}</p>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead className="text-right">Shown</TableHead>
              <TableHead className="text-right">Followed</TableHead>
              <TableHead className="text-right">Dismissed</TableHead>
              <TableHead>Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((r) => {
              const share = dismissedShare(r);
              return (
                <TableRow key={r.ruleId}>
                  <TableCell className="min-w-56 whitespace-normal">
                    <Link href={`/admin/assistant/insights/${r.ruleId}?days=${days}`} className="font-medium text-primary hover:underline">
                      {r.title}
                    </Link>
                    <span className="block text-meta text-muted-foreground">On at: {whereOn(r.enabled)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.shown}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.accepted}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.dismissed + r.notUseful}
                    {share !== null ? <span className="block text-meta text-muted-foreground">{share}% of answers</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col items-start gap-1">
                      {r.reviewDue ? (
                        <Badge variant="warning">
                          <ClockIcon className="size-3.5" aria-hidden />
                          Review due
                        </Badge>
                      ) : null}
                      {r.reviewSuggested ? (
                        <Badge variant="warning">
                          <AlertTriangleIcon className="size-3.5" aria-hidden />
                          Mostly dismissed
                        </Badge>
                      ) : null}
                      <span className="text-meta text-muted-foreground">{reviewSummary(r.lastReview, r.ruleVersion)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </StaffSettingsPage>
  );
}
