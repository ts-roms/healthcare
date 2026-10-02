import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { OutreachCampaign, OutreachSegment } from "@/lib/api/types";
import { CAMPAIGN_STATUS, CHANNEL_LABEL, SUPPRESSION_LABEL } from "@/lib/outreach-mapping";
import { CampaignActions } from "./campaign-actions";

export const metadata = { title: "Campaign" };

const UUID = /^[0-9a-f-]{36}$/i;

/** One campaign: its wording as approved, who did what, and once sent the counts by channel and outcome. */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "crm.read")) redirect("/");
  if (!UUID.test(id)) notFound();
  let campaign: OutreachCampaign;
  try {
    campaign = await api<OutreachCampaign>(`/outreach/campaigns/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const segments = campaign.status === "draft" ? (await api<OutreachSegment[]>("/outreach/segments")).filter((s) => s.status === "active") : [];
  const status = CAMPAIGN_STATUS[campaign.status];

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={
          <>
            <Badge variant={status.tone}>{status.label}</Badge> · {campaign.segmentName} · {campaign.channels.map((ch) => CHANNEL_LABEL[ch]).join(", ")}
          </>
        }
        actions={
          <Link href="/outreach" className="text-table text-primary hover:underline">
            All campaigns
          </Link>
        }
      />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            {campaign.subject ? <p className="font-medium">{campaign.subject}</p> : null}
            <p className="whitespace-pre-wrap">{campaign.body}</p>
            <p className="text-meta text-muted-foreground">
              {campaign.sendAt ? `Send at ${clinicalDateTime(campaign.sendAt)}.` : "Sent as soon as approved."} Emails carry an opt-out link.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-table">
            <p>Drafted {clinicalDateTime(campaign.createdAt)}</p>
            {campaign.submittedAt ? <p>Submitted {clinicalDateTime(campaign.submittedAt)}</p> : null}
            {campaign.approvedAt ? <p>Approved {clinicalDateTime(campaign.approvedAt)} by someone other than the author</p> : null}
            {campaign.startedAt ? <p>Sending started {clinicalDateTime(campaign.startedAt)}</p> : null}
            {campaign.completedAt ? <p>Completed {clinicalDateTime(campaign.completedAt)}</p> : null}
            {campaign.cancelledAt ? (
              <p>
                Cancelled {clinicalDateTime(campaign.cancelledAt)}: {campaign.cancelReason}
              </p>
            ) : null}
            <CampaignActions
              campaign={campaign}
              segments={segments}
              canManage={can(session, "crm.campaign.manage")}
              canApprove={can(session, "crm.campaign.approve")}
              currentUserId={session.user.id}
            />
          </CardContent>
        </Card>
        {campaign.summary ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Result</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-table">
                {campaign.summary.patients} patient{campaign.summary.patients === 1 ? "" : "s"} in the segment when it was sent. Counts only: who got what is in
                Communications, never here.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Queued</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Not sent</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaign.summary.byChannel.map((row) => (
                    <TableRow key={row.channel}>
                      <TableCell>{CHANNEL_LABEL[row.channel]}</TableCell>
                      <TableCell className="tabular text-right">{row.queued}</TableCell>
                      <TableCell className="tabular text-right">{row.delivered}</TableCell>
                      <TableCell className="tabular text-right">{row.suppressed}</TableCell>
                      <TableCell className="tabular text-right">{row.failed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {campaign.summary.suppressedByReason.length > 0 ? (
                <p className="text-meta text-muted-foreground">
                  Not sent: {campaign.summary.suppressedByReason.map((r) => `${SUPPRESSION_LABEL[r.reason] ?? r.reason} (${r.total})`).join(", ")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
