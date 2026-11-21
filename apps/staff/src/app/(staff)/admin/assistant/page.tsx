import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { StaffSettingsPage } from "@/components/settings-page";
import { api } from "@/lib/api/client";
import { can, getFacilities, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AssistantInsights, AssistantRule } from "@/lib/api/types";
import { RuleSettingForm } from "./rule-setting-form";

export const metadata = { title: "Assistant" };

const WHOLE_ORGANIZATION = "the whole organization";

export default async function AssistantSettingsPage({ searchParams }: { searchParams: Promise<{ facility?: string }> }) {
  const [params, session, selected] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "assistant.configure")) redirect("/");
  const facilities = (await getFacilities()).filter((f) => f.status === "active");
  const facility = facilities.find((f) => f.id === params.facility) ?? null;
  const [rules, insights] = await Promise.all([
    api<AssistantRule[]>("/assistant/rules", { query: { facilityId: facility?.id } }),
    can(session, "assistant.insights.read") ? api<AssistantInsights>("/assistant/insights", { query: { days: 90 } }) : null,
  ]);
  const scopeName = facility?.name ?? WHOLE_ORGANIZATION;
  const reviewDue = insights?.rules.filter((r) => r.reviewDue).length ?? 0;
  const mostlyDismissed = insights?.rules.filter((r) => r.reviewSuggested).length ?? 0;
  // "Try these values" reads one facility: this scope's, else the one selected in the top bar.
  const replayFacility = facility ?? selected;

  return (
    <StaffSettingsPage
      group="Organization"
      title="Assistant"
      description="Suggestions shown to staff from fixed rules over your own records."
      details={[
        "Every rule is off until you turn it on here.",
        "A suggestion says which rule made it and what it looked at. It never changes a record, orders or decides anything: staff act on the screen it links to.",
        "Set a rule for the whole organization, then change it for one facility where that facility works differently. A facility without its own setting follows the organization's.",
        "Each change is kept as a new version and recorded in the audit log.",
      ]}
    >
      <nav aria-label="Where the settings apply" className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-meta text-muted-foreground">Settings for:</span>
        <Button asChild size="sm" variant={facility ? "ghost" : "secondary"}>
          <Link href="/admin/assistant" aria-current={facility ? undefined : "page"}>
            Whole organization
          </Link>
        </Button>
        {facilities.map((f) => (
          <Button key={f.id} asChild size="sm" variant={facility?.id === f.id ? "secondary" : "ghost"}>
            <Link href={`/admin/assistant?facility=${f.id}`} aria-current={facility?.id === f.id ? "page" : undefined}>
              {f.name}
            </Link>
          </Button>
        ))}
      </nav>

      {rules.length === 0 ? (
        <p className="text-body text-muted-foreground">No rules are available yet.</p>
      ) : (
        rules.map((rule) => (
          <RuleSettingForm
            key={`${rule.ruleId}-${facility?.id ?? "org"}-${rule.setting?.version ?? 0}`}
            rule={rule}
            scopeName={scopeName}
            replayFacility={replayFacility ? { id: replayFacility.id, name: replayFacility.name } : null}
          />
        ))
      )}

      {insights ? (
        <Card>
          <CardHeader>
            <CardTitle>Insights and reviews</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <CardDescription className="text-table">
              {reviewDue === 0 && mostlyDismissed === 0
                ? "No rule is due for review, and none is mostly dismissed."
                : `${reviewDue} ${reviewDue === 1 ? "rule is" : "rules are"} due for review; ${mostlyDismissed} ${mostlyDismissed === 1 ? "is" : "are"} mostly dismissed.`}{" "}
              See how often each rule was shown, followed and dismissed, what staff said, and record your review: keep, adjust or retire a rule.
            </CardDescription>
            <Button asChild size="sm" variant="outline" className="self-start">
              <Link href="/admin/assistant/insights">Open insights and reviews</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </StaffSettingsPage>
  );
}
