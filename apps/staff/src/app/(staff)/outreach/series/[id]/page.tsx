import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { OutreachSegment, OutreachSeries, OutreachSeriesOccurrence } from "@/lib/api/types";
import { CAMPAIGN_STATUS, CHANNEL_LABEL, DELIVERY_MODE_LABEL, describeSchedule, fillWording, SERIES_STATUS } from "@/lib/outreach-mapping";
import { SeriesActions } from "./series-actions";

export const metadata = { title: "Recurring campaign" };

const UUID = /^[0-9a-f-]{36}$/i;

/** One recurring campaign: its wording and schedule as approved, who did what, and each occurrence (an ordinary campaign with its own results). */
export default async function SeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "crm.read")) redirect("/");
  if (!UUID.test(id)) notFound();
  let data: { series: OutreachSeries; occurrences: OutreachSeriesOccurrence[] };
  try {
    data = await api<{ series: OutreachSeries; occurrences: OutreachSeriesOccurrence[] }>(`/outreach/series/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { series, occurrences } = data;
  const segments = series.status === "draft" ? (await api<OutreachSegment[]>("/outreach/segments")).filter((s) => s.status === "active") : [];
  const status = SERIES_STATUS[series.status];

  return (
    <ModulePage
      title={series.name}
      description={
        <>
          <Badge variant={status.tone}>{status.label}</Badge> · {series.segmentName} · {series.channels.map((ch) => CHANNEL_LABEL[ch]).join(", ")}
        </>
      }
      actions={
        <Link href="/outreach" className="text-table text-primary hover:underline">
          All campaigns
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Message and schedule</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p className="font-medium">{describeSchedule(series)}</p>
            {series.status === "active" && series.nextRunAt ? <p className="text-muted-foreground">Next: {clinicalDateTime(series.nextRunAt)}</p> : null}
            {series.subject ? <p className="font-medium">{series.subject}</p> : null}
            <p className="whitespace-pre-wrap">{series.body}</p>
            {/{{\s*\w+\s*}}/.test(`${series.subject ?? ""}${series.body}`) ? (
              <p className="rounded-md bg-muted/50 p-2 text-meta">
                <span className="font-medium">How it reads for Maria: </span>
                {fillWording(series.body, "Maria", session.organization.name)}
              </p>
            ) : null}
            <p className="text-meta text-muted-foreground">
              {DELIVERY_MODE_LABEL[series.deliveryMode]}.{series.includeBookingLink ? " Each message ends with a link to book a visit in MyHealth." : ""} Emails
              carry an opt-out link.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-table">
            <p>Drafted {clinicalDateTime(series.createdAt)}</p>
            {series.submittedAt ? <p>Submitted {clinicalDateTime(series.submittedAt)}</p> : null}
            {series.approvedAt ? <p>Approved {clinicalDateTime(series.approvedAt)} by someone other than the author</p> : null}
            {series.closedAt || series.closeReason ? (
              <p>
                {series.status === "cancelled" ? "Cancelled" : "Ended"}
                {series.closedAt ? ` ${clinicalDateTime(series.closedAt)}` : ""}: {series.closeReason}
              </p>
            ) : null}
            <SeriesActions
              series={series}
              segments={segments}
              canManage={can(session, "crm.campaign.manage")}
              canApprove={can(session, "crm.campaign.approve")}
              currentUserId={session.user.id}
              clinicName={session.organization.name}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Occurrences</CardTitle>
          </CardHeader>
          <CardContent>
            {occurrences.length === 0 ? (
              <p className="text-table text-muted-foreground">None yet. Each one is created at its time and appears here, with its own results.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {occurrences.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="tabular">{o.occurrenceOn}</TableCell>
                      <TableCell>
                        <Link href={`/outreach/campaigns/${o.id}`} className="text-primary hover:underline">
                          {o.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={CAMPAIGN_STATUS[o.status].tone}>{CAMPAIGN_STATUS[o.status].label}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </ModulePage>
  );
}
