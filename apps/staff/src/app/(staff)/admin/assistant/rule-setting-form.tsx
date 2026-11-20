"use client";

import * as React from "react";
import { CircleCheckIcon, CircleOffIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Label, toast } from "@healthcare/ui/primitives";
import type { AssistantRule } from "@/lib/api/types";
import { expectedVersion, parameterFields, readParameters, ruleState, ruleStateLabel } from "@/lib/assistant-settings";
import { useServerAction } from "@/lib/use-server-action";
import { saveAssistantRule } from "./actions";

/** One assistant rule's on/off switch and parameters for the scope the page shows (the organization, or one facility). */
export function RuleSettingForm({ rule, scopeName }: { rule: AssistantRule; scopeName: string }) {
  const state = ruleState(rule);
  const fields = parameterFields(rule);
  const [enabled, setEnabled] = React.useState(state.kind !== "unset" && state.enabled);
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  const on = state.kind !== "unset" && state.enabled;
  const id = (key: string) => `${rule.ruleId}-${key}`;

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
          <fieldset className="grid gap-3 sm:grid-cols-2" disabled={!enabled}>
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
          <p className="text-meta text-muted-foreground">
            The starting values are a suggestion, not a standard: set them from your own suppliers and stock policy.
            {rule.setting ? ` Last changed ${clinicalDateTime(rule.setting.updatedAt)} (version ${rule.setting.version}).` : ""}
          </p>
          <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
