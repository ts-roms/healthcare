import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
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
            <CardTitle>How staff answered (last {insights.days} days)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <CardDescription className="text-table">
              Counts only, for the whole organization. A rule that is mostly dismissed is worth a look: its thresholds may not suit how you work.
            </CardDescription>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Dismissed</TableHead>
                  <TableHead className="text-right">Not useful</TableHead>
                  <TableHead className="text-right">Answered</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {insights.rules.map((r) => (
                  <TableRow key={r.ruleId}>
                    <TableCell>{r.title}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.accepted}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.dismissed}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.notUseful}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.answered}</TableCell>
                    <TableCell>
                      {r.reviewSuggested ? (
                        <Badge variant="warning">
                          <AlertTriangleIcon className="size-3.5" aria-hidden />
                          Mostly dismissed
                        </Badge>
                      ) : (
                        <span className="text-meta text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </StaffSettingsPage>
  );
}
