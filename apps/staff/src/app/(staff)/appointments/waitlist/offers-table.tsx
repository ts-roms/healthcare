"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@healthcare/ui/primitives";
import type { WaitlistOffer, WaitlistOfferStatus } from "@/lib/api/types";
import { acceptWaitlistOffer, withdrawWaitlistOffer } from "../actions";

type Row = WaitlistOffer & { practitionerName: string | null; visitTypeName: string | null };

const STATUS: Record<WaitlistOfferStatus, { label: string; variant: "info" | "success" | "neutral" | "warning" }> = {
  offered: { label: "Held", variant: "info" },
  accepted: { label: "Accepted", variant: "success" },
  declined: { label: "Declined", variant: "neutral" },
  expired: { label: "Expired", variant: "neutral" },
  withdrawn: { label: "Withdrawn", variant: "neutral" },
  taken: { label: "Taken by another", variant: "warning" },
};

/**
 * Times held for waiting patients (migration 0096): the patient accepts in MyHealth, or staff accept for them after
 * speaking to them (booked at the front desk); a held time can be withdrawn with a reason.
 */
export function OffersTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const router = useRouter();
  const [withdrawing, setWithdrawing] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const accept = (offerId: string, who: string) =>
    startTransition(async () => {
      const result = await acceptWaitlistOffer(offerId);
      if (result.ok) toast.success(`Booked ${who}`);
      else toast.error(result.message);
      router.refresh();
    });
  const withdraw = (offerId: string) =>
    startTransition(async () => {
      const result = await withdrawWaitlistOffer({ offerId, reason });
      if (result.ok) {
        toast.success("Offer withdrawn");
        setWithdrawing(null);
        setReason("");
      } else toast.error(result.message);
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-2 p-4 pt-0">
      <h2 className="text-section font-semibold">Times being held</h2>
      <Card className="py-0">
        {rows.length === 0 ? (
          <p className="p-4 text-body text-muted-foreground">No time is being held for a waiting patient.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Time held</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Held until</TableHead>
                <TableHead>Status</TableHead>
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
                    </TableCell>
                    <TableCell className="text-meta">{clinicalDateTime(r.startsAt)}</TableCell>
                    <TableCell className="text-meta">
                      {r.visitTypeName ?? "Visit"}
                      <span className="block text-muted-foreground">{r.practitionerName ?? "Practitioner"}</span>
                    </TableCell>
                    <TableCell className="text-meta">{r.status === "offered" ? clinicalDateTime(r.expiresAt) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                      {r.status === "accepted" ? (
                        <span className="block text-meta text-muted-foreground">{r.acceptedByPatient ? "By the patient" : "By staff"}</span>
                      ) : null}
                      {r.withdrawReason ? <span className="block text-meta text-muted-foreground">{r.withdrawReason}</span> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && r.status === "offered" ? (
                        <div className="flex justify-end gap-2">
                          <Button size="xs" variant="outline" disabled={pending} onClick={() => accept(r.id, r.patient?.displayName ?? "the patient")}>
                            Accept for patient
                          </Button>
                          <Button size="xs" variant="ghost" disabled={pending} onClick={() => setWithdrawing(withdrawing === r.id ? null : r.id)}>
                            Withdraw
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {withdrawing === r.id ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            withdraw(r.id);
                          }}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <div className="flex flex-col gap-1">
                            <Label htmlFor={`withdraw-${r.id}`}>Reason</Label>
                            <Input
                              id={`withdraw-${r.id}`}
                              value={reason}
                              maxLength={500}
                              onChange={(e) => setReason(e.target.value)}
                              required
                              className="w-80"
                            />
                          </div>
                          <Button type="submit" size="sm" disabled={pending || reason.trim().length < 3}>
                            Withdraw the offer
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
