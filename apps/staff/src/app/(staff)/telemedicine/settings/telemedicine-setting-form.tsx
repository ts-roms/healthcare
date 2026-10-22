"use client";

import * as React from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Label, Switch } from "@healthcare/ui/primitives";
import type { TelemedicineSetting, VideoReadiness } from "@/lib/api/types";
import { useServerAction } from "@/lib/use-server-action";
import { saveTelemedicineSetting } from "./actions";

export function TelemedicineSettingForm({ setting, video }: { setting: TelemedicineSetting; video: VideoReadiness | null }) {
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Video</CardTitle>
          {video ? (
            <Badge variant={!video.configured ? "warning" : video.reachable ? "success" : "danger"} className="ml-auto">
              {!video.configured ? "Not set up" : video.reachable ? "Answering" : "Not answering"}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-table">
          <p className="text-muted-foreground">
            {!video
              ? "The video status could not be read right now."
              : !video.configured
                ? "Video is not set up on this server, so doctors call patients on their callback number. An administrator sets it up with LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET."
                : video.reachable
                  ? "The video server answers. Calls are not recorded."
                  : `${video.detail ?? "The video server could not be reached."} Patients cannot join a video call until it is back.`}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Payment before the waiting room</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="tele-payment-required" className="text-body font-medium">
              Require payment before the waiting room
            </Label>
            <p className="mt-1 text-meta text-muted-foreground">
              When on, a patient cannot enter the waiting room of an online visit until its invoice is paid (online, or at the cashier). When off, nothing is
              asked for up front and the visit is charged when the consultation is signed, as before.
            </p>
          </div>
          <Switch
            id="tele-payment-required"
            disabled={pending}
            checked={setting.paymentRequired}
            onCheckedChange={(paymentRequired) =>
              run(
                () => saveTelemedicineSetting({ paymentRequired, version: setting.version }),
                paymentRequired ? "Payment is now required" : "Payment is no longer required",
              )
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
