"use client";

import * as React from "react";
import { CircleCheckIcon, CircleOffIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Label, toast } from "@healthcare/ui/primitives";
import type { AssistantRule } from "@/lib/api/types";
import { expectedVersion, parameterFields, readParameters, replaySummary, reviewSummary, ruleState, ruleStateLabel } from "@/lib/assistant-settings";
import { useServerAction } from "@/lib/use-server-action";
import { replayAssistantRule, saveAssistantRule } from "./actions";

/** Past days a "Try these values" replay reads. */
const REPLAY_DAYS = 14;

/**
 * One assistant rule's on/off switch and parameters for the scope the page shows (the organization, or one facility),
 * with "Try these values": how often the rule would have spoken over the last two weeks at `replayFacility`.
 */
export function RuleSettingForm({
  rule,
  scopeName,
  replayFacility,
}: {
  rule: AssistantRule;
  scopeName: string;
  /** The facility a replay reads: the one this scope is, else the one selected in the top bar; null = none selected. */
  replayFacility: { id: string; name: string } | null;
}) {
  const state = ruleState(rule);
  const fields = parameterFields(rule);
  const [enabled, setEnabled] = React.useState(state.kind !== "unset" && state.enabled);
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  const on = state.kind !== "unset" && state.enabled;
  const id = (key: string) => `${rule.ruleId}-${key}`;
  const [replay, setReplay] = React.useState<{ text: string; notes: string[] } | null>(null);
  const [replaying, startReplay] = React.useTransition();

  function tryValues() {
    if (!replayFacility) return;
    const read = readParameters(fields, values);
    if (!read.ok) {
      toast.error(read.message);
      return;
    }
    startReplay(async () => {
      const result = await replayAssistantRule({ ruleId: rule.ruleId, facilityId: replayFacility.id, parameters: read.parameters, days: REPLAY_DAYS });
      if (result.ok) setReplay({ text: replaySummary(result.data, replayFacility.name), notes: result.data.notes });
      else toast.error(result.message);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <CardTitle className="leading-snug">{rule.title}</CardTitle>
        <CardAction>
          <Badge variant={on ? "success" : "neutral"}>
            {on ? <CircleCheckIcon className="size-3.5" aria-hidden /> : <CircleOffIcon className="size-3.5" aria-hidden />}
            {ruleStateLabel(state, scopeName)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <CardDescription className="text-table">{rule.description}</CardDescription>
        {rule.lastReview ? (
          <div className="rounded-md bg-muted/50 p-3 text-table">
            <p>
              <span className="font-medium">{reviewSummary(rule.lastReview, rule.ruleVersion)}:</span> {rule.lastReview.note}
            </p>
            {rule.lastReview.falsePositives ? <p className="mt-1 text-muted-foreground">Known false positives: {rule.lastReview.falsePositives}</p> : null}
          </div>
        ) : null}
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const read = readParameters(fields, values);
            if (!read.ok) {
              toast.error(read.message);
              return;
            }
            run(
              () =>
                saveAssistantRule({
                  ruleId: rule.ruleId,
                  facilityId: rule.scope.facilityId,
                  enabled,
                  parameters: read.parameters,
                  expectedVersion: expectedVersion(rule),
                }),
              enabled ? `Turned on for ${scopeName}` : `Turned off for ${scopeName}`,
            );
          }}
        >
          <label className="flex items-center gap-2 text-table">
            <Checkbox
              id={id("enabled")}
              aria-label={`Show these suggestions at ${scopeName}`}
              checked={enabled}
              onCheckedChange={(v) => setEnabled(v === true)}
            />{" "}
            Show these suggestions at {scopeName}
          </label>
          {state.kind === "inherited" ? (
            <p className="-mt-2 text-meta text-muted-foreground">
              Saving gives {scopeName} a setting of its own; later changes to the organization&apos;s setting no longer apply here.
            </p>
          ) : null}
          {fields.length === 0 ? (
            <p className="text-table text-muted-foreground">This rule has no thresholds: it speaks whenever it finds what it checks for.</p>
          ) : (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-table font-medium">Your thresholds</legend>
              {fields.map((field) => (
                <div key={field.key} className="grid gap-1">
                  <Label htmlFor={id(field.key)}>{field.label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={id(field.key)}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={field.min}
                      max={field.max}
                      className="w-28"
                      value={values[field.key] ?? ""}
                      aria-describedby={field.hint ? id(`${field.key}-hint`) : undefined}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    />
                    {field.unit ? <span className="text-table text-muted-foreground">{field.unit}</span> : null}
                  </div>
                  {field.hint ? (
                    <p id={id(`${field.key}-hint`)} className="text-meta text-muted-foreground">
                      {field.hint}
                    </p>
                  ) : null}
                </div>
              ))}
            </fieldset>
          )}
          {fields.length > 0 || rule.setting ? (
            <p className="text-meta text-muted-foreground">
              {[
                fields.length > 0 ? "The starting values are a suggestion, not a standard: set them from how your clinic works." : null,
                rule.setting ? `Last changed ${clinicalDateTime(rule.setting.updatedAt)} (version ${rule.setting.version}).` : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={replaying || !replayFacility} onClick={tryValues}>
              {replaying ? "Trying…" : "Try these values"}
            </Button>
            {!replayFacility ? <span className="text-meta text-muted-foreground">Select a facility in the top bar to try values.</span> : null}
          </div>
          {replay ? (
            <div role="status" className="rounded-md bg-muted/50 p-3 text-table">
              <p>{replay.text}</p>
              {replay.notes.map((note) => (
                <p key={note} className="mt-1 text-meta text-muted-foreground">
                  {note}
                </p>
              ))}
              <p className="mt-1 text-meta text-muted-foreground">Nothing was saved or shown to anyone else.</p>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
