import { CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { OutreachReach } from "@/lib/api/types";
import { CHANNEL_LABEL, SUPPRESSION_LABEL } from "@/lib/outreach-mapping";

/**
 * Who a message can actually reach: for each channel, the patients who opted in and have a way to be contacted, and why
 * the others cannot be (no opt-in, opted out, no number or address, no MyHealth account). The same checks the send makes,
 * so the figures here are what a send would do, before anything goes out. Counts only: no names.
 */
export function ReachPanel({ reach, total }: { reach: OutreachReach; total: number }) {
  if (reach.evaluated === 0) return <p className="text-meta text-muted-foreground">Nobody to check yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-table">
        <span className="flex items-center gap-1.5 font-medium">
          <CheckCircle2Icon className="size-4 text-success-foreground" aria-hidden /> {reach.reachableOnAny} of {reach.evaluated} can be messaged
        </span>
        {reach.unreachable > 0 ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <XCircleIcon className="size-4" aria-hidden /> {reach.unreachable} cannot be messaged on any of these channels
          </span>
        ) : null}
      </p>
      {reach.sampled ? (
        <p className="text-meta text-muted-foreground">
          Checked the first {reach.evaluated} of {total} patients; the others are not counted here.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead className="text-right">Can be reached</TableHead>
            <TableHead>Cannot, because</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reach.byChannel.map((row) => (
            <TableRow key={row.channel}>
              <TableCell>{CHANNEL_LABEL[row.channel]}</TableCell>
              <TableCell className="tabular text-right">{row.reachable}</TableCell>
              <TableCell className="text-meta text-muted-foreground">
                {row.notReached.length === 0 ? "Everyone can" : row.notReached.map((r) => `${SUPPRESSION_LABEL[r.reason] ?? r.reason} (${r.total})`).join(", ")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
