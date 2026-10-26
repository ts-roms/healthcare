import Link from "next/link";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import type { OutreachSeries } from "@/lib/api/types";
import { CHANNEL_LABEL, describeSchedule, SERIES_STATUS } from "@/lib/outreach-mapping";

/** Campaigns that repeat: the schedule, where each stands, and when the next one goes out. New ones start from New campaign → Repeat. */
export function SeriesList({ series, canApprove, currentUserId }: { series: OutreachSeries[]; canApprove: boolean; currentUserId: string }) {
  if (series.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recurring campaigns</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {series.map((s) => {
            const status = SERIES_STATUS[s.status];
            const waitingOnMe = s.status === "submitted" && canApprove && s.createdBy !== currentUserId && s.submittedBy !== currentUserId;
            return (
              <li key={s.id} className="py-3 text-table">
                <p className="font-medium">
                  <Link href={`/outreach/series/${s.id}`} className="text-primary hover:underline">
                    {s.name}
                  </Link>{" "}
                  <Badge variant={status.tone}>{status.label}</Badge> {waitingOnMe ? <Badge variant="info">Your approval</Badge> : null}
                </p>
                <p className="text-muted-foreground">
                  {s.segmentName} · {s.channels.map((ch) => CHANNEL_LABEL[ch]).join(", ")}
                </p>
                <p className="text-muted-foreground">
                  {describeSchedule(s)}
                  {s.status === "active" && s.nextRunAt ? ` · next ${clinicalDateTime(s.nextRunAt)}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
