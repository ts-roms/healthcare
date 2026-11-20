"use client";

import * as React from "react";
import { ChevronDownIcon, InfoIcon, LightbulbIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { Badge, type BadgeProps } from "../primitives/badge";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";

/** What the API's `GET /assistant/suggestions` returns for one suggestion (libs/core `Suggestion`), as the panel reads it. */
export interface AssistantSuggestionView {
  id: string;
  ruleId: string;
  ruleVersion: number;
  severity: "info" | "advice" | "warning";
  title: string;
  rationale: string;
  evidence: Array<{ label: string; value?: string }>;
  basis: "rule" | "statistic" | "text-match";
  strength: "matched" | "weak";
  action?: { label: string; href: string };
}

export type AssistantOutcome = "accepted" | "dismissed" | "not_useful";

const SEVERITY: Record<AssistantSuggestionView["severity"], { label: string; icon: LucideIcon; variant: NonNullable<BadgeProps["variant"]> }> = {
  info: { label: "For your information", icon: InfoIcon, variant: "neutral" },
  advice: { label: "Consider", icon: LightbulbIcon, variant: "info" },
  warning: { label: "Check soon", icon: TriangleAlertIcon, variant: "warning" },
};

const BASIS: Record<AssistantSuggestionView["basis"], string> = {
  rule: "A fixed rule",
  statistic: "A pattern in your own records",
  "text-match": "Matching words",
};

/**
 * Decision support from the heuristic assistant (docs/architecture/heuristic-assistant.md): each suggestion says what
 * rule produced it and what it looked at ("Why?"), says when the data was thin, and can be dismissed. It never changes
 * a record; its action is only a link. Severity is a label with an icon, never colour alone.
 */
export function AssistantPanel({
  suggestions,
  dismissedCount = 0,
  withheldCount = 0,
  onAnswer,
  className,
}: {
  suggestions: readonly AssistantSuggestionView[];
  /** Hidden because this person dismissed them recently. */
  dismissedCount?: number;
  /** Rules on here that need a permission the person lacks. */
  withheldCount?: number;
  onAnswer?: (id: string, outcome: AssistantOutcome) => void | Promise<void>;
  className?: string;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className={cn("rounded-xl border border-border/70 bg-card p-4 text-card-foreground shadow-xs", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-page-sm flex items-center gap-2 font-semibold">
          <LightbulbIcon className="size-4" aria-hidden />
          Suggestions
        </h2>
        <Badge variant="neutral">Decision support</Badge>
      </div>
      {suggestions.length === 0 ? (
        <p className="mt-3 text-body text-muted-foreground">Nothing to suggest right now.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {suggestions.map((s) => (
            <li key={s.id}>
              <SuggestionCard suggestion={s} onAnswer={onAnswer} />
            </li>
          ))}
        </ul>
      )}
      {dismissedCount > 0 || withheldCount > 0 ? (
        <p className="mt-3 text-table text-muted-foreground">
          {dismissedCount > 0 ? `${dismissedCount} you dismissed recently ${dismissedCount === 1 ? "is" : "are"} hidden.` : null}
          {dismissedCount > 0 && withheldCount > 0 ? " " : null}
          {withheldCount > 0 ? "Some suggestions are not available to you." : null}
        </p>
      ) : null}
      <p className="mt-3 text-table text-muted-foreground">Suggestions come from fixed rules, not a diagnosis. You decide.</p>
    </section>
  );
}

export function SuggestionCard({
  suggestion,
  onAnswer,
}: {
  suggestion: AssistantSuggestionView;
  onAnswer?: (id: string, outcome: AssistantOutcome) => void | Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const spec = SEVERITY[suggestion.severity];
  const Icon = spec.icon;
  const whyId = React.useId();

  async function answer(outcome: AssistantOutcome) {
    if (!onAnswer) return;
    setBusy(true);
    try {
      await onAnswer(suggestion.id, outcome);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-lg border border-border/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={spec.variant}>
          <Icon className="size-3.5" aria-hidden />
          {spec.label}
        </Badge>
        {suggestion.strength === "weak" ? <Badge variant="neutral">Based on limited data</Badge> : null}
      </div>
      <h3 className="mt-2 text-body font-semibold">{suggestion.title}</h3>
      <p className="mt-1 text-body text-muted-foreground">{suggestion.rationale}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {suggestion.action ? (
          <Button asChild size="sm">
            <a href={suggestion.action.href}>{suggestion.action.label}</a>
          </Button>
        ) : null}
        {onAnswer ? (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => answer("dismissed")}>
              Dismiss
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => answer("not_useful")}>
              Not useful
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={whyId} onClick={() => setOpen((v) => !v)} className="ml-auto">
          Why?
          <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        </Button>
      </div>
      {open ? (
        <div id={whyId} className="mt-2 rounded-md bg-muted/50 p-3 text-table">
          <p className="font-medium">{BASIS[suggestion.basis]}</p>
          <ul className="mt-1 list-disc pl-5">
            {suggestion.evidence.map((e) => (
              <li key={`${e.label}:${e.value ?? ""}`}>
                {e.label}
                {e.value ? `: ${e.value}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">
            Rule {suggestion.ruleId}, version {suggestion.ruleVersion}.
          </p>
        </div>
      ) : null}
    </article>
  );
}
