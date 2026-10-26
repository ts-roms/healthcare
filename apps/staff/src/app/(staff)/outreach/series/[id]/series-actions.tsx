"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import type { OutreachSegment, OutreachSeries } from "@/lib/api/types";
import { closeSeries, moveSeries } from "../../actions";
import { CampaignForm } from "../../campaign-list";

/**
 * What can be done with a recurring campaign: submit it, have a second person approve it, pause and resume it, take it back
 * to a draft to change it (the approval is gone), and end it or cancel it with a reason.
 */
export function SeriesActions({
  series,
  segments,
  canManage,
  canApprove,
  currentUserId,
  clinicName,
}: {
  series: OutreachSeries;
  segments: OutreachSegment[];
  canManage: boolean;
  canApprove: boolean;
  currentUserId: string;
  clinicName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState(false);
  const [closing, setClosing] = React.useState<"end" | "cancel" | null>(null);
  const [reason, setReason] = React.useState("");
  const isAuthor = series.createdBy === currentUserId || series.submittedBy === currentUserId;

  const move = (action: "submit" | "reopen" | "approve" | "pause" | "resume", done: string) =>
    startTransition(async () => {
      const result = await moveSeries(series.id, action, series.version);
      if (result.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(result.message);
    });

  if (editing) return <CampaignForm campaign={null} series={series} segments={segments} clinicName={clinicName} onDone={() => setEditing(false)} />;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canManage && series.status === "draft" ? (
          <>
            <Button size="sm" onClick={() => move("submit", "Submitted for approval")} disabled={pending}>
              Submit for approval
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
              Change
            </Button>
          </>
        ) : null}
        {canManage && series.status === "submitted" ? (
          <Button size="sm" variant="outline" onClick={() => move("reopen", "Back to draft")} disabled={pending}>
            Back to draft
          </Button>
        ) : null}
        {canApprove && series.status === "submitted" ? (
          <Button
            size="sm"
            onClick={() => move("approve", "Approved: it will go out at each occurrence")}
            disabled={pending || isAuthor}
            title={isAuthor ? "Someone else must approve a recurring campaign you wrote or submitted" : undefined}
          >
            Approve
          </Button>
        ) : null}
        {canManage && series.status === "active" ? (
          <Button size="sm" variant="outline" onClick={() => move("pause", "Paused: nothing more is sent until you resume")} disabled={pending}>
            Pause
          </Button>
        ) : null}
        {canManage && series.status === "paused" ? (
          <>
            <Button size="sm" onClick={() => move("resume", "Resumed at its next occurrence")} disabled={pending}>
              Resume
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => move("reopen", "Back to draft: change it, then submit it for approval again")}
              disabled={pending}
            >
              Change (back to draft)
            </Button>
          </>
        ) : null}
        {canManage && ["active", "paused"].includes(series.status) && closing === null ? (
          <Button size="sm" variant="ghost" onClick={() => setClosing("end")} disabled={pending}>
            End for good
          </Button>
        ) : null}
        {canManage && ["draft", "submitted"].includes(series.status) && closing === null ? (
          <Button size="sm" variant="ghost" onClick={() => setClosing("cancel")} disabled={pending}>
            Cancel
          </Button>
        ) : null}
      </div>
      {isAuthor && series.status === "submitted" && canApprove ? (
        <p className="text-meta text-muted-foreground">You wrote or submitted this, so someone else must approve it.</p>
      ) : null}
      {series.status === "active" ? (
        <p className="text-meta text-muted-foreground">
          To change the wording or the schedule: pause it, take it back to a draft, change it and have it approved again.
        </p>
      ) : null}
      {closing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await closeSeries(series.id, closing, series.version, reason);
              if (result.ok) {
                toast.success(closing === "end" ? "Ended" : "Cancelled");
                setClosing(null);
                router.refresh();
              } else toast.error(result.message);
            });
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="sr-reason">Why</Label>
            <Input id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="w-72" />
          </div>
          <Button type="submit" size="sm" variant="destructive" disabled={pending || reason.trim().length < 3}>
            {closing === "end" ? "Confirm end" : "Confirm cancel"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setClosing(null)} disabled={pending}>
            Keep
          </Button>
        </form>
      ) : null}
    </div>
  );
}
