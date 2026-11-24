import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LightbulbIcon } from "lucide-react";
import { Button, Callout, EmptyState } from "@healthcare/ui/primitives";
import { AssistantSuggestions } from "@/components/assistant-suggestions";
import { FacilityRequired } from "@/components/facility-required";
import { ModulePage } from "@/components/module-page";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import { ASSISTANT_HOME, assistantArea, canOpenArea, checksOnText, SURFACE_SCREENS } from "@/lib/assistant-areas";
import { loadOverview } from "@/lib/assistant-suggestions";
import { ASSISTANT_SECTION_DETAILS, FOOTNOTE, NO_CHECK_ON } from "../explanation";
import { RuleStates } from "../rule-states";

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params;
  return { title: assistantArea(area)?.label ?? "Suggestions" };
}

/**
 * One area of the Assistant section (docs/domains/assistant.md, "Assistant section"): for each of its screens, every
 * suggestion its checks make now and each check the person may read, with its state.
 */
export default async function AssistantAreaPage({ params }: { params: Promise<{ area: string }> }) {
  const [{ area: key }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "assistant.use")) redirect("/");
  const area = assistantArea(key);
  if (!area) notFound();
  if (!canOpenArea(area, session.permissions)) redirect(ASSISTANT_HOME);
  if (!facility) {
    return (
      <ModulePage title={area.label}>
        <FacilityRequired action="The assistant's checks run per facility." />
      </ModulePage>
    );
  }
  const overview = await loadOverview(area.surfaces);
  const readable = overview?.surfaces.filter((s) => s.rules.length > 0) ?? [];

  return (
    <ModulePage
      title={area.label}
      description={`What the assistant's checks say now at ${facility.name}. It only suggests; you act on the screen each suggestion links to.`}
      details={ASSISTANT_SECTION_DETAILS}
    >
      {!overview ? (
        <Callout tone="warning" title="The assistant could not answer just now.">
          Try again in a moment. Each screen still shows its own suggestions.
        </Callout>
      ) : readable.length === 0 ? (
        <EmptyState icon={LightbulbIcon} title="No check here is available to you" />
      ) : (
        <>
          {readable.map((s) => {
            const screen = SURFACE_SCREENS[s.surface];
            const on = s.rules.filter((r) => r.on);
            const speaksHere = on.some((r) => r.needs === "nothing");
            return (
              <div key={s.surface} className="grid gap-3">
                <AssistantSuggestions
                  surface={s.surface}
                  suggestions={{ items: s.items, dismissed: s.dismissed, withheld: s.withheld }}
                  title={screen?.label ?? "Suggestions"}
                  description={[checksOnText(on.length, s.rules.length, facility.name), s.failed ? "A check could not be read just now." : null]
                    .filter(Boolean)
                    .join(" ")}
                  actions={
                    screen ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={screen.href}>Open {screen.label}</Link>
                      </Button>
                    ) : null
                  }
                  emptyText={speaksHere ? "Nothing to suggest right now." : NO_CHECK_ON}
                  footnote={false}
                />
                <div className="rounded-xl border border-border/70 bg-card px-4 py-2">
                  <h3 className="pt-1 text-table font-medium text-muted-foreground">Checks here</h3>
                  <RuleStates rules={s.rules} />
                </div>
              </div>
            );
          })}
          <p className="text-table text-muted-foreground">{FOOTNOTE}</p>
        </>
      )}
    </ModulePage>
  );
}
