"use client";

import * as React from "react";
import { PrinterIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { KioskPrintJob } from "@/lib/api/types";
import { PRINT_STATUS_LABEL, PRINT_STATUS_VARIANT, printErrorText } from "@/lib/kiosk-devices";
import { useServerAction } from "@/lib/use-server-action";
import { reprintTicket } from "./actions";

/**
 * The kiosk tickets of the last 24 hours and how each print went. A ticket that is finished can be printed again by staff
 * with a reason (limited, audited, only while the patient is still in the queue). Nothing here names a patient.
 */
export function PrintJobs({ jobs, canReprint }: { jobs: KioskPrintJob[]; canReprint: boolean }) {
  const [reprinting, setReprinting] = React.useState<string | null>(null);
  return (
    <Card className="py-0">
      {jobs.length === 0 ? (
        <p className="p-4 text-body text-muted-foreground">No kiosk tickets were issued in the last 24 hours.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Kiosk</TableHead>
              <TableHead>Print</TableHead>
              <TableHead>When</TableHead>
              {canReprint ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((j) =>
              reprinting === j.id ? (
                <ReprintRow key={j.id} job={j} onDone={() => setReprinting(null)} />
              ) : (
                <TableRow key={j.id}>
                  <TableCell>
                    <span className="font-mono font-medium">{j.ticket}</span>
                    <span className="block text-meta text-muted-foreground">
                      {j.serviceName}
                      {j.reprint ? " · printed again" : ""}
                    </span>
                  </TableCell>
                  <TableCell>{j.device}</TableCell>
                  <TableCell>
                    <Badge variant={PRINT_STATUS_VARIANT[j.status]}>{PRINT_STATUS_LABEL[j.status]}</Badge>
                    {j.lastError ? <span className="block text-meta text-muted-foreground">{printErrorText(j.lastError)}</span> : null}
                    {j.attempts > 1 ? <span className="block text-meta text-muted-foreground">{j.attempts} attempts</span> : null}
                  </TableCell>
                  <TableCell className="text-table">{clinicalDateTime(j.printedAt ?? j.createdAt)}</TableCell>
                  {canReprint ? (
                    <TableCell className="text-right">
                      {j.canReprint ? (
                        <Button size="xs" variant="outline" onClick={() => setReprinting(j.id)} aria-label={`Print ticket ${j.ticket} again`}>
                          <PrinterIcon /> Print again…
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function ReprintRow({ job, onDone }: { job: KioskPrintJob; onDone: () => void }) {
  const [reason, setReason] = React.useState("");
  const { pending, run } = useServerAction();
  return (
    <TableRow>
      <TableCell colSpan={5}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => reprintTicket({ jobId: job.id, reason }), `${job.ticket} will print again`, onDone);
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`reprint-${job.id}`}>Print {job.ticket} again: why? *</Label>
            <Input
              id={`reprint-${job.id}`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Kept in the audit trail"
              className="w-80"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending || reason.trim().length < 5}>
            Print again
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </form>
      </TableCell>
    </TableRow>
  );
}
