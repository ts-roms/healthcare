import { ModulePage } from "@/components/module-page";
import { redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { OutreachCampaign, OutreachSegment } from "@/lib/api/types";
import { CampaignList } from "./campaign-list";
import { SegmentList } from "./segment-list";

export const metadata = { title: "Outreach" };

/** Outreach the organization plans: segments (who), campaigns (what, approved by a second person) and their results. */
export default async function OutreachPage() {
  const session = await getSession();
  if (!can(session, "crm.read")) redirect("/");
  const [segments, campaigns] = await Promise.all([api<OutreachSegment[]>("/outreach/segments"), api<OutreachCampaign[]>("/outreach/campaigns")]);
  return (
    <ModulePage
      title="Outreach"
      description="Messages the clinic plans for groups of patients. Each patient's own opt-in per channel decides whether a message goes out; messages about care, appointments and bills are not affected."
    >
      <SegmentList segments={segments} canManage={can(session, "crm.segment.manage")} />
      <CampaignList
        campaigns={campaigns}
        segments={segments.filter((s) => s.status === "active")}
        canManage={can(session, "crm.campaign.manage")}
        canApprove={can(session, "crm.campaign.approve")}
        currentUserId={session.user.id}
      />
      <p className="text-meta text-muted-foreground">
        Segments use what the record says about a person (age, sex, place, registration and visit dates, a care-plan activity due, an opt-in) and never a
        diagnosis, a result or a medication. Every preview, approval and run is recorded in the audit trail; what was sent appears in Communications.
      </p>
    </ModulePage>
  );
}
