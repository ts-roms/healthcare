import Link from "next/link";
import { redirect } from "next/navigation";
import { LightbulbIcon } from "lucide-react";
import { Button, Callout, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@healthcare/ui/primitives";
import { AssistantSuggestions } from "@/components/assistant-suggestions";
import { FacilityRequired } from "@/components/facility-required";
import { ModulePage } from "@/components/module-page";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import { areasFor, checksOnText, overviewSurfaces, recordRules, summarizeArea } from "@/lib/assistant-areas";
import { loadOverview } from "@/lib/assistant-suggestions";
import { ASSISTANT_SECTION_DETAILS, FOOTNOTE, NO_CHECK_ON } from "./explanation";
import { RuleStates } from "./rule-states";

export const metadata = { title: "Suggestions" };

/** Suggestions shown per area here; the rest are on the area's own tab. */
const PER_AREA = 3;

/**
 * The Assistant section's overview (docs/domains/assistant.md, "Assistant section"): every area the person may open,
 * each with its most pressing suggestions and how many of its checks are on, then the checks that speak only inside a
 * patient's record. One request to the API, audited once.
 */
export default async function AssistantSuggestionsPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "assistant.use")) redirect("/");
  const actions = <AdminLinks permissions={session.permissions} />;
  if (!facility) {
    return (
      <ModulePage title="Suggestions" actions={actions}>
        <FacilityRequired action="The assistant's checks run per facility." />
      </ModulePage>
    );
  }
  const areas = areasFor(session.permissions);
  const overview = await loadOverview(overviewSurfaces(areas), PER_AREA);
  const records = overview ? recordRules(overview.surfaces) : [];

  return (
    <ModulePage
      title="Suggestions"
      description={`What the assistant's checks say now at ${facility.name}. Built-in rules and statistics: it only suggests, and nothing leaves this system.`}
      details={ASSISTANT_SECTION_DETAILS}
      actions={actions}
    >
      {!overview ? (
        <Callout tone="warning" title="The assistant could not answer just now.">
          Try again in a moment. Each screen still shows its own suggestions.
        </Callout>
      ) : areas.length === 0 && records.length === 0 ? (
        <EmptyState
          icon={LightbulbIcon}
          title="No checks are available to you"
          description="The assistant's checks read stock, billing, appointments, the laboratory and more. You see the ones your role can open."
        />
      ) : (
        <>
          {areas.map((a) => {
            const s = summarizeArea(a, overview.surfaces, PER_AREA);
            const notes = [
              checksOnText(s.rulesOn, s.rulesReadable, facility.name),
              s.more > 0 ? `${s.more} more on its tab.` : null,
              s.failed ? "A check could not be read just now." : null,
            ].filter(Boolean);
            return (
              <AssistantSuggestions
                key={a.key}
                surface={a.surfaces[0]}
                suggestions={{ items: s.items, dismissed: s.dismissed, withheld: s.withheld }}
                title={a.label}
                description={notes.join(" ")}
                actions={
                  <Button asChild size="sm" variant="outline">
                    <Link href={a.href}>Open {a.label}</Link>
                  </Button>
                }
                emptyText={s.rulesOn === 0 ? NO_CHECK_ON : "Nothing to suggest right now."}
                footnote={false}
              />
            );
          })}
          {records.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Checks that speak inside a patient&apos;s record</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <p className="text-table text-muted-foreground">
                  These read the consultation, patient or prescription on screen, so they speak only there, never here.
                </p>
                <RuleStates rules={records} />
              </CardContent>
            </Card>
          ) : null}
          <p className="text-table text-muted-foreground">{FOOTNOTE}</p>
        </>
      )}
    </ModulePage>
  );
}

/** For administrators: where checks are turned on, and how they did. */
function AdminLinks({ permissions }: { permissions: string[] }) {
  const configure = permissions.includes("assistant.configure");
  const insights = permissions.includes("assistant.insights.read");
  if (!configure && !insights) return null;
  return (
    <>
      {configure ? (
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/assistant">Rule settings</Link>
        </Button>
      ) : null}
      {insights ? (
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/assistant/insights">Insights and reviews</Link>
        </Button>
      ) : null}
    </>
  );
}
