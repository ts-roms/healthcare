"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import type { OutreachCampaign, OutreachSegment } from "@/lib/api/types";
import { cancelCampaign, moveCampaign } from "../../actions";
import { CampaignForm } from "../../campaign-list";

export function CampaignActions({
  campaign,
  segments,
  canManage,
  canApprove,
  currentUserId,
}: {
  campaign: OutreachCampaign;
  segments: OutreachSegment[];
  canManage: boolean;
  canApprove: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const isAuthor = campaign.createdBy === currentUserId || campaign.submittedBy === currentUserId;

  const move = (action: "submit" | "reopen" | "approve", done: string) =>
    startTransition(async () => {
      const result = await moveCampaign(campaign.id, action, campaign.version);
      if (result.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(result.message);
    });

  if (editing) return <CampaignForm campaign={campaign} segments={segments} onDone={() => setEditing(false)} />;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canManage && campaign.status === "draft" ? (
          <>
            <Button size="sm" onClick={() => move("submit", "Submitted for approval")} disabled={pending}>
              Submit for approval
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
              Change
            </Button>
          </>
        ) : null}
        {canManage && campaign.status === "submitted" ? (
          <Button size="sm" variant="outline" onClick={() => move("reopen", "Back to draft")} disabled={pending}>
            Back to draft
          </Button>
        ) : null}
        {canApprove && campaign.status === "submitted" ? (
          <Button
            size="sm"
            onClick={() => move("approve", "Approved")}
            disabled={pending || isAuthor}
            title={isAuthor ? "Someone else must approve a campaign you wrote or submitted" : undefined}
          >
            Approve
          </Button>
        ) : null}
        {canManage && ["draft", "submitted", "approved"].includes(campaign.status) && !cancelling ? (
          <Button size="sm" variant="ghost" onClick={() => setCancelling(true)} disabled={pending}>
            Cancel campaign
          </Button>
        ) : null}
      </div>
      {isAuthor && campaign.status === "submitted" && canApprove ? (
        <p className="text-meta text-muted-foreground">You wrote or submitted this campaign, so someone else must approve it.</p>
      ) : null}
      {cancelling ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await cancelCampaign(campaign.id, campaign.version, reason);
              if (result.ok) {
                toast.success("Campaign cancelled");
                setCancelling(false);
                router.refresh();
              } else toast.error(result.message);
            });
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="cp-cancel">Why</Label>
            <Input id="cp-cancel" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="w-72" />
          </div>
          <Button type="submit" size="sm" variant="destructive" disabled={pending || reason.trim().length < 3}>
            Confirm cancel
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(false)} disabled={pending}>
            Keep
          </Button>
        </form>
      ) : null}
    </div>
  );
}
