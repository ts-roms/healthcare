"use client";

import * as React from "react";
import { ClockIcon, ShieldCheckIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from "@healthcare/ui/primitives";
import type { OutreachCampaignReach } from "@/lib/api/types";
import { CHANNEL_LABEL } from "@/lib/outreach-mapping";
import { loadCampaignReach } from "../../actions";
import { ReachPanel } from "../../reach-panel";

/**
 * Before the campaign goes out: who it can reach on its channels, how many the frequency cap would hold back, and whether
 * quiet hours would hold the text messages and push notices. It checks the same things the send does and changes nothing.
 */
export function CampaignReachCard({ campaignId }: { campaignId: string }) {
  const [reach, setReach] = React.useState<OutreachCampaignReach | null>(null);
  const [pending, startTransition] = React.useTransition();
  const check = () =>
    startTransition(async () => {
      const result = await loadCampaignReach(campaignId);
      if (result.ok) setReach(result.data);
      else toast.error(result.message);
    });
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Who this can reach</CardTitle>
        <Button size="sm" variant="outline" onClick={check} disabled={pending}>
          {pending ? "Checking…" : reach ? "Check again" : "Check reach"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {reach === null ? (
          <p className="text-table text-muted-foreground">
            Shows how many of the segment can be messaged on this campaign&apos;s channels, and why the others cannot, before you send. Nothing is sent.
          </p>
        ) : (
          <>
            <ReachPanel reach={reach} total={reach.evaluated} />
            {reach.plannedChannels ? (
              <p className="text-table">
                One message per patient:{" "}
                {reach.plannedChannels.byChannel
                  .filter((c) => c.total > 0)
                  .map((c) => `${c.total} by ${CHANNEL_LABEL[c.channel].toLowerCase()}`)
                  .join(", ") || "none can be reached"}
                {reach.plannedChannels.none > 0 ? `; ${reach.plannedChannels.none} cannot be reached on any channel and are recorded as not sent` : ""}.
              </p>
            ) : null}
            {reach.frequencyCap ? (
              <p className="flex items-start gap-2 text-table">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  Frequency cap: at most {reach.frequencyCap.maxCampaigns} campaign{reach.frequencyCap.maxCampaigns === 1 ? "" : "s"} per patient in{" "}
                  {reach.frequencyCap.windowDays} days. {reach.frequencyCap.heldBack} patient{reach.frequencyCap.heldBack === 1 ? " is" : "s are"} already at it
                  and would be held back.
                </span>
              </p>
            ) : null}
            {reach.quietHours ? (
              <p className="flex items-start gap-2 text-table">
                <ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  Quiet hours {reach.quietHours.start}–{reach.quietHours.end} (Manila time) for{" "}
                  {reach.quietHours.channels.map((c) => CHANNEL_LABEL[c]).join(", ")}.{" "}
                  {reach.quietHours.holdingNow && reach.quietHours.until
                    ? `It is quiet time now: those messages would wait until ${clinicalDateTime(reach.quietHours.until)}.`
                    : "Those messages go out at once outside these hours."}
                </span>
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
