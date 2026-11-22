import { CircleCheckIcon, CircleOffIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import { NEED_PLACE } from "@/lib/assistant-areas";
import type { AssistantOverviewSurface } from "@/lib/api/types";

/**
 * The checks a person may read, each with whether it is on at the selected facility (text and an icon, never colour
 * alone) and, for a check that reads the record on screen, where it speaks. Thresholds stay on the settings page.
 */
export function RuleStates({ rules }: { rules: AssistantOverviewSurface["rules"] }) {
  return (
    <ul className="divide-y divide-border/70" aria-label="Checks">
      {rules.map((r) => (
        <li key={r.ruleId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium">{r.title}</p>
            <p className="text-table text-muted-foreground">{r.description}</p>
            {r.needs !== "nothing" ? <p className="mt-0.5 text-meta text-muted-foreground">Speaks only {NEED_PLACE[r.needs].toLowerCase()}.</p> : null}
          </div>
          <Badge variant={r.on ? "success" : "neutral"}>
            {r.on ? <CircleCheckIcon className="size-3.5" aria-hidden /> : <CircleOffIcon className="size-3.5" aria-hidden />}
            {r.on ? "On" : "Off"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
