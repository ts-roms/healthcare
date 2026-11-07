"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label } from "@healthcare/ui/primitives";
import type { QueueDisplaySettings } from "@/lib/api/types";
import { contrastWithWhite, MIN_ACCENT_CONTRAST } from "@/lib/display-colour";
import { useServerAction } from "@/lib/use-server-action";
import { saveQueueDisplaySettings } from "./actions";

/**
 * What the waiting-room display says in the clinic's own words, its colour and whether it groups calls by department
 * (service point). None of it is about a patient: the screen still shows only tickets and places.
 */
export function DisplaySettings({ settings }: { settings: QueueDisplaySettings }) {
  const [headline, setHeadline] = React.useState(settings.headline ?? "");
  const [footer, setFooter] = React.useState(settings.footerMessage ?? "");
  const [colour, setColour] = React.useState(settings.accentColor ?? "");
  const [grouped, setGrouped] = React.useState(settings.groupByServicePoint);
  const { pending, run } = useServerAction();

  const colourValid = colour === "" || /^#[0-9A-Fa-f]{6}$/.test(colour);
  const contrast = colourValid && colour ? contrastWithWhite(colour) : null;
  const readable = contrast === null || contrast >= MIN_ACCENT_CONTRAST;
  const changed =
    headline.trim() !== (settings.headline ?? "") ||
    footer.trim() !== (settings.footerMessage ?? "") ||
    colour.trim() !== (settings.accentColor ?? "") ||
    grouped !== settings.groupByServicePoint;

  return (
    <Card className="mx-4">
      <CardHeader>
        <CardTitle>Waiting-room display</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                saveQueueDisplaySettings({
                  facilityId: settings.facilityId,
                  headline,
                  footerMessage: footer,
                  accentColor: colour,
                  groupByServicePoint: grouped,
                  version: settings.version ?? undefined,
                }),
              "Display settings saved",
            );
          }}
        >
          <p className="text-meta text-muted-foreground">
            What the screen in the waiting area says, in your own words. The screen shows ticket numbers and places only, never a name or a patient number.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="display-headline">Headline (optional)</Label>
              <Input
                id="display-headline"
                value={headline}
                maxLength={80}
                placeholder="e.g. Welcome to our health center"
                onChange={(e) => setHeadline(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="display-footer">Footer line (optional)</Label>
              <Input
                id="display-footer"
                value={footer}
                maxLength={160}
                placeholder="e.g. Please keep your number until you are called."
                onChange={(e) => setFooter(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1 sm:max-w-xs">
            <Label htmlFor="display-colour">Colour (optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="display-colour"
                value={colour}
                maxLength={7}
                placeholder="#1A7F8E"
                aria-invalid={!colourValid || !readable}
                onChange={(e) => setColour(e.target.value)}
              />
              <span
                className="size-8 shrink-0 rounded-md border"
                style={{ backgroundColor: colourValid && colour ? colour : "var(--qd-accent, #0f5c57)" }}
                aria-hidden
              />
            </div>
            {!colourValid ? (
              <p role="alert" className="text-meta text-danger">
                Use a colour like #1A7F8E.
              </p>
            ) : !readable ? (
              <p role="alert" className="text-meta text-danger">
                White text on this colour is hard to read from across a room (contrast {contrast?.toFixed(1)}, at least {MIN_ACCENT_CONTRAST} needed). Choose a
                darker colour; until then the screen keeps its own.
              </p>
            ) : (
              <p className="text-meta text-muted-foreground">The ticket number is shown in white on this colour. Empty keeps the screen&apos;s own colour.</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-body">
            <Checkbox checked={grouped} onCheckedChange={(checked) => setGrouped(checked === true)} aria-label="Show calls by department" />
            Show calls by department (service point)
          </label>
          <p className="text-meta text-muted-foreground">
            Adds a block to the screen listing, for each service point, its latest calls and how many wait there. Off: the screen lists earlier calls.
          </p>
          <div>
            <Button type="submit" disabled={pending || !changed || !colourValid || !readable}>
              Save display settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
