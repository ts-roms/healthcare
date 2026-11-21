"use client";

import { AssistantPanel, type AssistantOutcome } from "@healthcare/ui/healthcare";
import { toast } from "@healthcare/ui/primitives";
import { answerSuggestion } from "@/app/(staff)/assistant-actions";
import type { AssistantSuggestions as Suggestions, AssistantSurface } from "@/lib/api/types";

const DONE: Record<AssistantOutcome, string> = {
  accepted: "Thanks — noted.",
  dismissed: "Dismissed. It stays hidden for you for 14 days.",
  not_useful: "Marked not useful. It stays hidden for you for 14 days.",
};

/**
 * Counts that the person followed a suggestion's link (outcome "accepted"). Sent as a beacon so the navigation is never
 * delayed and the count survives the page changing; a lost count never matters to the person.
 */
export function followSuggestion(id: string) {
  const body = JSON.stringify({ id });
  try {
    if (navigator.sendBeacon?.("/assistant/followed", new Blob([body], { type: "application/json" }))) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch("/assistant/followed", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
}

/** The assistant's suggestions for one screen (docs/domains/assistant.md); answers go through the server action. */
export function AssistantSuggestions({ surface, suggestions }: { surface: AssistantSurface; suggestions: Suggestions }) {
  async function onAnswer(id: string, outcome: AssistantOutcome, reason?: string) {
    const result = await answerSuggestion({ surface, id, outcome, reason });
    if (result.ok) toast.success(DONE[outcome]);
    else toast.error(result.message);
  }
  return (
    <AssistantPanel
      suggestions={suggestions.items}
      dismissedCount={suggestions.dismissed}
      withheldCount={suggestions.withheld.length}
      onAnswer={onAnswer}
      onFollow={followSuggestion}
    />
  );
}
