"use client";

import * as React from "react";
import { ChevronDownIcon, InfoIcon, LightbulbIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { Badge, type BadgeProps } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Label } from "../primitives/label";
import { Textarea } from "../primitives/textarea";
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

/** Records an answer; `reason` is the person's own words for "Not useful" (optional). */
export type AssistantAnswerHandler = (id: string, outcome: AssistantOutcome, reason?: string) => void | Promise<void>;

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
 * rule produced it and what it looked at ("Why?"), says when the data was thin, and can be dismissed or marked not useful
 * with a reason. It never changes a record; its action is only a link, and following it is counted (`onFollow`).
 * Severity is a label with an icon, never colour alone.
 */
export function AssistantPanel({
  suggestions,
  dismissedCount = 0,
  withheldCount = 0,
  onAnswer,
  onFollow,
  title = "Suggestions",
  description,
  actions,
  emptyText = "Nothing to suggest right now.",
  footnote = true,
  className,
}: {
  suggestions: readonly AssistantSuggestionView[];
  /** Hidden because this person dismissed them recently. */
  dismissedCount?: number;
  /** Rules on here that need a permission the person lacks. */
  withheldCount?: number;
  onAnswer?: AssistantAnswerHandler;
  /** Called when the person opens a suggestion's link (counted as followed; must not delay the navigation). */
  onFollow?: (id: string) => void;
  /** The panel's heading, and its region's name ("Suggestions" on a module's screen; an area's name in the Assistant section). */
  title?: string;
  /** A line under the heading, e.g. how many checks are on. */
  description?: React.ReactNode;
  /** Links beside the "Decision support" badge, e.g. to the screen these suggestions belong to. */
  actions?: React.ReactNode;
  /** What an empty list says (e.g. that no check is turned on here). */
  emptyText?: React.ReactNode;
  /** The closing sentence ("…not a diagnosis. You decide."); a page that shows it once leaves it out of each panel. */
  footnote?: boolean;
  className?: string;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className={cn("rounded-xl border border-border/70 bg-card p-4 text-card-foreground shadow-xs", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-page-sm flex items-center gap-2 font-semibold">
          <LightbulbIcon className="size-4" aria-hidden />
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Badge variant="neutral">Decision support</Badge>
        </div>
      </div>
      {description ? <p className="mt-1 text-table text-muted-foreground">{description}</p> : null}
      {suggestions.length === 0 ? (
        <p className="mt-3 text-body text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {suggestions.map((s) => (
            <li key={s.id}>
              <SuggestionCard suggestion={s} onAnswer={onAnswer} onFollow={onFollow} />
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
      {footnote ? <p className="mt-3 text-table text-muted-foreground">Suggestions come from fixed rules, not a diagnosis. You decide.</p> : null}
    </section>
  );
}

export function SuggestionCard({
  suggestion,
  onAnswer,
  onFollow,
}: {
  suggestion: AssistantSuggestionView;
  onAnswer?: AssistantAnswerHandler;
  onFollow?: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [explaining, setExplaining] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const spec = SEVERITY[suggestion.severity];
  const Icon = spec.icon;
  const whyId = React.useId();
  const reasonId = React.useId();

  async function answer(outcome: AssistantOutcome, why?: string) {
    if (!onAnswer) return;
    setBusy(true);
    try {
      await onAnswer(suggestion.id, outcome, why);
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
            <a
              href={suggestion.action.href}
              onClick={() => onFollow?.(suggestion.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onFollow?.(suggestion.id);
              }}
            >
              {suggestion.action.label}
            </a>
          </Button>
        ) : null}
        {onAnswer ? (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => answer("dismissed")}>
              Dismiss
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} aria-expanded={explaining} aria-controls={reasonId} onClick={() => setExplaining((v) => !v)}>
              Not useful
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={whyId} onClick={() => setOpen((v) => !v)} className="ml-auto">
          Why?
          <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        </Button>
      </div>
      {explaining ? (
        <form
          id={reasonId}
          className="mt-2 flex flex-col gap-2 rounded-md bg-muted/50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void answer("not_useful", reason.trim() || undefined).then(() => setExplaining(false));
          }}
        >
          <Label htmlFor={`${reasonId}-reason`}>What was wrong with it? (optional)</Label>
          <Textarea id={`${reasonId}-reason`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-table text-muted-foreground">
            Your administrator reads this when reviewing the rule. Do not write a patient&apos;s name or details.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              Mark not useful
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setExplaining(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
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
