import "server-only";
import { unstable_rethrow } from "next/navigation";
import { api } from "@/lib/api/client";
import { can } from "@/lib/api/session";
import type { AssistantSuggestions, AssistantSurface, Me } from "@/lib/api/types";

/**
 * A screen's assistant suggestions (docs/domains/assistant.md), or null when the person may not see them or the
 * assistant could not answer: it is decision support, so its screen always renders without it.
 */
export async function loadSuggestions(
  session: Pick<Me, "permissions">,
  surface: AssistantSurface,
  query: { date?: string; encounterId?: string; patientId?: string; prescriptionId?: string } = {},
): Promise<AssistantSuggestions | null> {
  if (!can(session, "assistant.use")) return null;
  try {
    return await api<AssistantSuggestions>("/assistant/suggestions", { query: { surface, ...query } });
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/** Whether the panel has something to say: suggestions, ones the person dismissed, or rules they may not see. */
export function hasSomethingToShow(suggestions: AssistantSuggestions | null): suggestions is AssistantSuggestions {
  return Boolean(suggestions && (suggestions.items.length > 0 || suggestions.dismissed > 0 || suggestions.withheld.length > 0));
}
