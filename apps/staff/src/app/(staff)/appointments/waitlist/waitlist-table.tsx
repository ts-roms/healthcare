"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Button, Card, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@healthcare/ui/primitives";
import type { WaitlistEntry } from "@/lib/api/types";
import { closeWaitlistEntry } from "../actions";

type Row = WaitlistEntry & { practitionerName: string | null; visitTypeName: string | null; days: string };

/** The waiting list; an entry is closed with a reason (booked another way, patient no longer needs it…). */
export function WaitlistTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const [closing, setClosing] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const close = (entryId: string) =>
    startTransition(async () => {
      const result = await closeWaitlistEntry({ entryId, reason });
      if (result.ok) {
        toast.success("Removed from the waiting list");
        setClosing(null);
        setReason("");
      } else toast.error(result.message);
    });
  return (
    <div className="p-4">
      <Card className="py-0">
        {rows.length === 0 ? (
          <p className="p-4 text-body text-muted-foreground">Nobody is waiting.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <TableRow>
                    <TableCell>
                      <Link href={`/patients/${r.patientId}`} className="text-primary hover:underline">
                        {r.patient?.displayName ?? "Unknown patient"}
                      </Link>
                      {r.patient ? <span className="text-muted-foreground"> · {r.patient.patientNumber}</span> : null}
                      {r.priority === "soon" ? (
                        <Badge variant="warning" className="ml-2">
                          Soon
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-meta">{r.days}</TableCell>
                    <TableCell className="text-meta">
                      {r.visitTypeName ?? "Any visit"}
                      <span className="block text-muted-foreground">{r.practitionerName ?? "Any doctor"}</span>
                    </TableCell>
                    <TableCell className="text-meta">
                      <Badge variant={r.createdByPatient ? "info" : "neutral"}>{r.createdByPatient ? "By the patient" : "By staff"}</Badge>
                      {r.notes ? <span className="block text-muted-foreground">{r.notes}</span> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canManage ? (
                          <Button asChild size="xs" variant="outline">
                            <Link
                              href={`/appointments/new?patientId=${r.patientId}${r.practitionerId ? `&practitionerId=${r.practitionerId}` : ""}${r.visitTypeId ? `&visitTypeId=${r.visitTypeId}` : ""}&date=${r.earliestDate}`}
                            >
                              Book
                            </Link>
                          </Button>
                        ) : null}
                        {canManage ? (
                          <Button size="xs" variant="ghost" onClick={() => setClosing(closing === r.id ? null : r.id)} disabled={pending}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {closing === r.id ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            close(r.id);
                          }}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <div className="flex flex-col gap-1">
                            <Label htmlFor={`reason-${r.id}`}>Reason</Label>
                            <Input id={`reason-${r.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required className="w-80" />
                          </div>
                          <Button type="submit" size="sm" disabled={pending || reason.trim().length < 3}>
                            Remove from the list
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
