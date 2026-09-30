"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import { Button, Checkbox, Label } from "@healthcare/ui/primitives";
import type { PortalPreferences } from "@/lib/api/types";
import {
  careMessagesOff,
  CATEGORY_ORDER,
  CATEGORY_TEXT,
  changedChoices,
  CHANNEL_TEXT,
  channelsShown,
  selectionKey,
  selectionOf,
} from "@/lib/notification-settings";
import { saveNotificationSettings } from "./actions";

/** Text message, email and push, per kind of message. Only what changed is saved; the destination is the number or address the clinic has on record. */
export function SettingsForm({ initial, pushConfigured }: { initial: PortalPreferences; pushConfigured: boolean }) {
  const channels = channelsShown(pushConfigured);
  const [saved, setSaved] = React.useState(() => selectionOf(initial.preferences));
  const [next, setNext] = React.useState(saved);
  const [destinations, setDestinations] = React.useState(initial.destinations);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = React.useTransition();
  const changes = changedChoices(saved, next);

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await saveNotificationSettings(changes);
      if (result.ok) {
        const now = selectionOf(result.data.preferences);
        setSaved(now);
        setNext(now);
        setDestinations(result.data.destinations);
        setMessage({ kind: "ok", text: "Saved. This applies from the next message." });
      } else setMessage({ kind: "error", text: result.message });
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {CATEGORY_ORDER.map((category) => (
        <fieldset key={category} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <legend className="px-1 font-semibold">{CATEGORY_TEXT[category].title}</legend>
          <p className="text-body text-muted-foreground">{CATEGORY_TEXT[category].about}</p>
          <div className="flex flex-col gap-2">
            {channels.map((channel) => {
              const key = selectionKey(channel, category);
              const id = `pref-${key}`;
              return (
                <div key={key} className="flex items-center gap-3">
                  <Checkbox id={id} checked={next[key] === true} onCheckedChange={(c) => setNext((n) => ({ ...n, [key]: c === true }))} disabled={pending} />
                  <Label htmlFor={id} className="flex flex-col items-start gap-0">
                    <span>{CHANNEL_TEXT[channel]}</span>
                    <span className="text-meta font-normal text-muted-foreground">
                      {destinations[channel]
                        ? `To ${destinations[channel]}`
                        : channel === "push"
                          ? "Turn on notifications on a device below first"
                          : "The clinic has no number or address on record — nothing can be sent"}
                    </span>
                  </Label>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      {careMessagesOff(next, channels) ? (
        <p role="status" className="flex gap-2 rounded-lg border border-warning/40 bg-warning-subtle p-3 text-body text-warning-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Messages about your care are off on every channel. Check MyHealth yourself for new results and follow-up.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || changes.length === 0}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {message ? (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`flex items-center gap-1.5 text-body ${message.kind === "error" ? "text-destructive" : "text-success-foreground"}`}
          >
            {message.kind === "ok" ? <CheckCircle2Icon className="size-4" aria-hidden /> : null}
            {message.text}
          </p>
        ) : null}
      </div>
      <p className="text-meta text-muted-foreground">To change the number or address the clinic uses, ask the clinic to update your record.</p>
    </form>
  );
}
