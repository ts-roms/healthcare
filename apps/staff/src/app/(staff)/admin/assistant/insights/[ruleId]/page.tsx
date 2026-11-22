import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangleIcon, ClockIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { StaffSettingsPage } from "@/components/settings-page";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { AssistantInsights, AssistantRuleReview } from "@/lib/api/types";
import { dismissedShare, REVIEW_OUTCOME_LABEL, ruleOnLabel, whereOn } from "@/lib/assistant-settings";
import { todayIn } from "@/lib/clinic-mapping";
import { RuleLimits } from "../../rule-limits";
import { RuleReviewForm } from "./rule-review-form";

export const metadata = { title: "Assistant rule" };

const PERIODS = [30, 90, 365] as const;
const RULE_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/;

/** One rule for its periodic review: how it was used, what staff said, the review form and the reviews so far. */
export default async function AssistantRuleInsightPage({
  params,
  searchParams,
}: {
  params: Promise<{ ruleId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const [{ ruleId }, query, session] = await Promise.all([params, searchParams, getSession()]);
  if (!can(session, "assistant.insights.read")) redirect("/");
  if (!RULE_ID.test(ruleId)) notFound();
  const days = PERIODS.find((d) => String(d) === query.days) ?? 90;
  const [insights, reviews] = await Promise.all([
    api<AssistantInsights>("/assistant/insights", { query: { days } }),
    api<AssistantRuleReview[]>(`/assistant/rules/${encodeURIComponent(ruleId)}/reviews`),
  ]);
  const rule = insights.rules.find((r) => r.ruleId === ruleId);
  if (!rule) notFound();
  const share = dismissedShare(rule);
  return (
    <StaffSettingsPage
      group="Organization"
      title={rule.title}
      description={rule.description}
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/assistant/insights?days=${days}`}>All rules</Link>
          </Button>
          {can(session, "assistant.configure") ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/assistant">Change its settings</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>
            Last {days} days · {ruleOnLabel(rule.enabled).toLowerCase()}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Shown", rule.shown],
              ["Followed", rule.accepted],
              ["Dismissed", rule.dismissed],
              ["Not useful", rule.notUseful],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted/50 p-3">
                <dt className="text-meta text-muted-foreground">{label}</dt>
                <dd className="text-section-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2 text-table">
            {share !== null ? <span>{share}% of answers were dismissals or &ldquo;not useful&rdquo;.</span> : <span>No answers in this period.</span>}
            {rule.reviewDue ? (
              <Badge variant="warning">
                <ClockIcon className="size-3.5" aria-hidden />
                Review due
              </Badge>
            ) : null}
            {rule.reviewSuggested ? (
              <Badge variant="warning">
                <AlertTriangleIcon className="size-3.5" aria-hidden />
                Mostly dismissed
              </Badge>
            ) : null}
            <span className="text-muted-foreground">
              Rule {rule.ruleId}, version {rule.ruleVersion}.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When it can be wrong</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <CardDescription>
            Documented with the rule for every organization. The false positives your organization finds go in its reviews below.
          </CardDescription>
          <RuleLimits limits={rule} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What staff said</CardTitle>
        </CardHeader>
        <CardContent>
          {rule.reasons.length === 0 ? (
            <p className="text-body text-muted-foreground">No reasons given in this period.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-body">
              {rule.reasons.map((r) => (
                <li key={`${r.at}-${r.reason}`} className="rounded-md border p-2">
                  <p className="text-meta text-muted-foreground">
                    {r.outcome === "not_useful" ? "Not useful" : "Dismissed"} · {clinicalDateTime(r.at)}
                  </p>
                  <p>{r.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {can(session, "assistant.configure") ? (
        <Card>
          <CardHeader>
            <CardTitle>Record a review</CardTitle>
          </CardHeader>
          <CardContent>
            <RuleReviewForm ruleId={rule.ruleId} today={todayIn("Asia/Manila")} on={whereOn(rule.enabled) !== "Off"} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Reviews</CardTitle>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-body text-muted-foreground">This rule has not been reviewed yet.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-body">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-md border p-3">
                  <p className="text-meta text-muted-foreground">
                    {r.reviewedOn} · {REVIEW_OUTCOME_LABEL[r.outcome]} · version {r.ruleVersion} · recorded by {r.recordedBy}
                  </p>
                  <p className="mt-1">{r.note}</p>
                  {r.falsePositives ? <p className="mt-1 text-muted-foreground">False positives found: {r.falsePositives}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </StaffSettingsPage>
  );
}
