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

/** The assistant's suggestions for one screen (docs/domains/assistant.md); answers go through the server action. */
export function AssistantSuggestions({ surface, suggestions }: { surface: AssistantSurface; suggestions: Suggestions }) {
  async function onAnswer(id: string, outcome: AssistantOutcome) {
    const result = await answerSuggestion({ surface, id, outcome });
    if (result.ok) toast.success(DONE[outcome]);
    else toast.error(result.message);
  }
  return (
    <AssistantPanel suggestions={suggestions.items} dismissedCount={suggestions.dismissed} withheldCount={suggestions.withheld.length} onAnswer={onAnswer} />
  );
}
