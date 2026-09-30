"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { AppointmentItem, Referral } from "@/lib/api/types";
import { answerReferral, cancelReferral, completeReferral, linkReferralAppointment } from "../actions";

type Result = { ok: true } | { ok: false; message: string };

/** What the viewer may do next on a referral; the API checks every step again. */
export function ReferralActions({
  referral,
  canComplete,
  canCancel,
  canBook,
  appointments,
  bookHref,
}: {
  referral: Referral;
  canComplete: boolean;
  canCancel: boolean;
  canBook: boolean;
  /** Upcoming appointments of this patient with the practitioner referred to (internal referrals). */
  appointments: AppointmentItem[];
  bookHref: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const [replyDocumentId, setReplyDocumentId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [appointmentId, setAppointmentId] = React.useState(appointments[0]?.id ?? "");
  const run = (call: () => Promise<Result>, done: string) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(result.message);
    });
  const open = referral.status === "sent" || referral.status === "accepted";
  const version = referral.version;
  if (!open) return null;

  return (
    <div className="flex h-fit flex-col gap-3">
      {referral.kind === "internal" && referral.status === "sent" && referral.forYou ? (
        <Card>
          <CardHeader>
            <CardTitle>Your answer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="answer-note">Note to the referrer (required to decline)</Label>
            <Textarea id="answer-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2">
              <Button disabled={pending} onClick={() => run(() => answerReferral(referral.id, { decision: "accept", note, version }), "Referral accepted")}>
                Accept
              </Button>
              <Button
                variant="outline"
                disabled={pending || note.trim().length < 3}
                onClick={() => run(() => answerReferral(referral.id, { decision: "decline", note, version }), "Referral declined")}
              >
                Decline
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {referral.kind === "internal" && canBook ? (
        <Card>
          <CardHeader>
            <CardTitle>Appointment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            {appointments.length ? (
              <>
                <Label htmlFor="referral-appointment">Link an appointment with {referral.toPractitioner?.displayName ?? "the practitioner"}</Label>
                <NativeSelect id="referral-appointment" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
                  {appointments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {clinicalDateTime(a.startsAt)}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={pending || !appointmentId}
                  onClick={() => run(() => linkReferralAppointment(referral.id, { appointmentId, version }), "Appointment linked")}
                >
                  Link appointment
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">No upcoming appointment with the practitioner referred to.</p>
            )}
            {bookHref ? (
              <Button asChild size="sm" variant="ghost" className="self-start">
                <Link href={bookHref}>Book an appointment…</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {canComplete ? (
        <Card>
          <CardHeader>
            <CardTitle>{referral.kind === "internal" ? "Complete" : "Record the reply"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="referral-outcome">{referral.kind === "internal" ? "What came of it" : "The provider's reply, as received"}</Label>
            <Textarea id="referral-outcome" rows={3} maxLength={2000} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            {referral.kind === "external" ? (
              <>
                <Label htmlFor="referral-reply">Reply document id (optional; upload it to the patient record first)</Label>
                <Input id="referral-reply" value={replyDocumentId} onChange={(e) => setReplyDocumentId(e.target.value.trim())} />
              </>
            ) : null}
            <Button
              className="self-start"
              disabled={pending || outcome.trim().length < 3}
              onClick={() =>
                run(() => completeReferral(referral.id, { outcomeNote: outcome, replyDocumentId: replyDocumentId || undefined, version }), "Referral completed")
              }
            >
              {referral.kind === "internal" ? "Complete referral" : "Record reply"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {canCancel ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancel</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="referral-cancel">Reason</Label>
            <Textarea id="referral-cancel" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button
              variant="destructive"
              className="self-start"
              disabled={pending || reason.trim().length < 5}
              onClick={() => run(() => cancelReferral(referral.id, { reason, version }), "Referral cancelled")}
            >
              Cancel referral
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
