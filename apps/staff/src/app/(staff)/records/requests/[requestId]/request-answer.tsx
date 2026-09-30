"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { RecordsRequestDetail } from "@/lib/api/types";
import { declineRequest, fulfilRequest, startReview } from "../actions";

/** Answering a request: take it into review, share documents from the patient's record, or decline with a reason. */
export function RequestAnswer({ request, identityCheckRequired }: { request: RecordsRequestDetail; identityCheckRequired: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [note, setNote] = React.useState("");
  const [identity, setIdentity] = React.useState("");
  const [declining, setDeclining] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const run = (call: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong.");
    });
  const toggle = (id: string) => setChosen((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : new Set([...prev, id])));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Answer</CardTitle>
        {request.status === "submitted" ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={pending}
            onClick={() => run(() => startReview(request.id, request.version), "Taken into review")}
          >
            Take into review
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-table font-medium">Documents to share from the patient&apos;s record</legend>
          {request.available.length === 0 ? (
            <p className="text-meta text-muted-foreground">
              No documents in the record yet. Upload the copies to the{" "}
              <Link className="text-primary hover:underline" href={`/patients/${request.patientId}`}>
                patient&apos;s record
              </Link>
              , then come back.
            </p>
          ) : null}
          {request.available.map((d) => (
            <label key={d.id} className="flex items-start gap-2 text-table">
              <Checkbox className="mt-1" checked={chosen.has(d.id)} onCheckedChange={() => toggle(d.id)} />
              <span>
                {d.title}
                <span className="text-meta text-muted-foreground">
                  {" "}
                  · {d.category.replace(/_/g, " ")} · {clinicalDate(d.createdAt)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-1">
          <Label htmlFor="share-note">Note to the patient (optional)</Label>
          <Textarea id="share-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="identity-check">How the requester&apos;s identity was confirmed{identityCheckRequired ? "" : " (optional)"}</Label>
          <Input
            id="identity-check"
            maxLength={200}
            placeholder="e.g. Valid ID shown at the counter"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || chosen.size === 0 || (identityCheckRequired && identity.trim().length < 3)}
            onClick={() =>
              run(
                () =>
                  fulfilRequest({
                    requestId: request.id,
                    documentIds: [...chosen],
                    note: note.trim() || undefined,
                    identityCheckMethod: identity.trim() || undefined,
                    version: request.version,
                  }),
                "Shared — the patient can download the documents in MyHealth",
              )
            }
          >
            Share {chosen.size ? `${chosen.size} document${chosen.size === 1 ? "" : "s"}` : "documents"}
          </Button>
          {!declining ? (
            <Button variant="ghost" onClick={() => setDeclining(true)}>
              Decline…
            </Button>
          ) : null}
        </div>
        {declining ? (
          <form
            className="flex flex-col gap-2 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => declineRequest({ requestId: request.id, reason, version: request.version }), "Declined — the patient reads your reason in MyHealth");
            }}
          >
            <Label htmlFor="decline-reason">Reason the patient will read</Label>
            <Textarea id="decline-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={pending || reason.trim().length < 3}>
                Decline request
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDeclining(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
