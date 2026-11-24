"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, DateInput, Label, RadioGroup, RadioGroupTile, Textarea, toast } from "@healthcare/ui/primitives";
import type { AssistantReviewOutcome } from "@/lib/api/types";
import { recordRuleReview } from "../../actions";

const CHOICES: Array<{ value: AssistantReviewOutcome; label: string; hint: string }> = [
  { value: "keep", label: "Keep it as it is", hint: "Its suggestions are useful at the thresholds set." },
  { value: "adjust", label: "Adjust its thresholds", hint: "Change them under Rule settings (try the new values first); this records why." },
  { value: "retire", label: "Retire it", hint: "Turns the rule off wherever it is on in the organization. You can turn it on again later." },
];

/** The organization's review of one rule (docs/runbooks/assistant-rule-review.md): the decision, why, and false positives found. */
export function RuleReviewForm({ ruleId, today, on }: { ruleId: string; today: string; on: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [outcome, setOutcome] = React.useState<AssistantReviewOutcome>("keep");
  const [note, setNote] = React.useState("");
  const [falsePositives, setFalsePositives] = React.useState("");
  const [reviewedOn, setReviewedOn] = React.useState(today);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await recordRuleReview({ ruleId, outcome, note, falsePositives, reviewedOn });
          if (result.ok) {
            toast.success(
              outcome === "retire"
                ? result.data.turnedOff > 0
                  ? "Review recorded; the rule is now off everywhere."
                  : "Review recorded; the rule was already off."
                : "Review recorded",
            );
            setNote("");
            setFalsePositives("");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-table font-medium">Decision</legend>
        <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as AssistantReviewOutcome)} className="grid gap-2 sm:grid-cols-3">
          {CHOICES.map((c) => (
            <RadioGroupTile key={c.value} value={c.value} id={`review-${c.value}`} className="p-3">
              <span className="font-medium">{c.label}</span>
              <span className="block text-meta text-muted-foreground">{c.hint}</span>
            </RadioGroupTile>
          ))}
        </RadioGroup>
        {outcome === "retire" && !on ? (
          <p className="text-meta text-muted-foreground">The rule is off everywhere already; the review is still recorded.</p>
        ) : null}
      </fieldset>
      <div className="flex flex-col gap-1">
        <Label htmlFor="review-note">What was decided and why</Label>
        <Textarea id="review-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="review-false-positives">False positives found (optional)</Label>
        <Textarea id="review-false-positives" rows={2} maxLength={1000} value={falsePositives} onChange={(e) => setFalsePositives(e.target.value)} />
        <p className="text-meta text-muted-foreground">
          Situations where the rule spoke and should not have, as a pattern. Shown on the rule&apos;s settings card. No patient names or details.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="review-date">Reviewed on</Label>
        <DateInput id="review-date" max={today} value={reviewedOn} onChange={(e) => setReviewedOn(e.target.value)} className="w-44" />
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {outcome === "retire" ? "Retire the rule" : "Record review"}
      </Button>
    </form>
  );
}
