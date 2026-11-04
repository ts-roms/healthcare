"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, LinkIcon, ShieldCheckIcon, TriangleAlertIcon, UserCheckIcon, XCircleIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Checkbox, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { KioskDuplicateCandidate, KioskRegistrationDetail } from "@/lib/api/types";
import { approveRegistration, linkRegistration, rejectRegistration } from "../actions";

const SEX_LABEL: Record<string, string> = { female: "Female", male: "Male", intersex: "Intersex", unknown: "Not stated" };

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 border-b py-2 last:border-b-0">
      <dt className="text-table text-muted-foreground">{term}</dt>
      <dd className="text-body font-medium break-words">{children}</dd>
    </div>
  );
}

/**
 * The reception desk's decision on one kiosk registration. The checklist is the desk's own step before deciding (it is not
 * stored); approving runs the front desk's ordinary registration, so a likely duplicate is refused unless the reviewer
 * confirms the candidates and says why. Correcting a detail is done on the patient record afterwards (Edit details).
 */
export function RegistrationReview({
  detail,
  visitTypes,
  canApprove,
  canLink,
  canOpenRecord,
}: {
  detail: KioskRegistrationDetail;
  visitTypes: Array<{ id: string; name: string }>;
  canApprove: boolean;
  canLink: boolean;
  canOpenRecord: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [verified, setVerified] = React.useState(false);
  const [identityNote, setIdentityNote] = React.useState("");
  const [visitTypeId, setVisitTypeId] = React.useState("");
  const [differentPerson, setDifferentPerson] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const [done, setDone] = React.useState<{ patientId: string; patientNumber?: string; linked: boolean } | null>(null);

  const r = detail.registration;
  const candidates = detail.possibleDuplicates;
  const hasCandidates = candidates.length > 0;
  const mobile = r.contacts.find((c) => c.system === "mobile");
  const email = r.contacts.find((c) => c.system === "email");
  const address = r.addresses[0];
  const overrideReady = !hasCandidates || (differentPerson && overrideReason.trim().length >= 5);

  const run = (call: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>, onOk: (data: never) => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) onOk(result.data as never);
      else {
        toast.error(result.message);
        router.refresh();
      }
    });

  if (done) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 text-section font-semibold">
          <CheckCircle2Icon className="size-5 text-success" aria-hidden /> {done.linked ? "Linked to the existing record" : "Patient registered"}
          {done.patientNumber ? <span className="font-mono text-body font-normal text-muted-foreground">{done.patientNumber}</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {canOpenRecord ? (
            <Button asChild size="sm">
              <Link href={`/patients/${done.patientId}`}>Open the patient record</Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href="/queue/registrations">Back to registrations</Link>
          </Button>
        </div>
      </Card>
    );
  }

  const candidateCard = (c: KioskDuplicateCandidate) => (
    <li key={c.patient.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">
          {c.patient.displayName} <span className="font-mono text-table font-normal text-muted-foreground">{c.patient.patientNumber}</span>
        </p>
        <p className="text-table text-muted-foreground">
          {clinicalDate(`${c.patient.birthDate}T12:00:00Z`)} · {c.patient.age} y · {SEX_LABEL[c.patient.sex] ?? c.patient.sex}
          {c.patient.primaryMobileMasked ? ` · ${c.patient.primaryMobileMasked}` : ""}
        </p>
        {c.reasons?.length ? <p className="text-meta text-muted-foreground">Matched on: {c.reasons.join(", ").replace(/_/g, " ")}</p> : null}
      </div>
      {c.level ? <Badge variant={c.level === "high" ? "danger" : "warning"}>{c.level === "high" ? "Likely the same person" : "Possible match"}</Badge> : null}
      {canLink ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !verified}
          title={verified ? undefined : "Check the person's identification first"}
          onClick={() =>
            run(
              () =>
                linkRegistration({
                  registrationId: detail.id,
                  patientId: c.patient.id,
                  visitTypeId: visitTypeId || undefined,
                  identityChecked: true,
                  identityNote: identityNote.trim() || undefined,
                }),
              (data: { patientId: string }) => {
                toast.success("Linked to the existing record");
                setDone({ patientId: data.patientId, linked: true });
              },
            )
          }
        >
          <LinkIcon /> Same person — link
        </Button>
      ) : null}
    </li>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="p-4">
          <h2 className="text-section font-semibold">What the person typed</h2>
          <dl className="mt-2">
            <Row term="Name">{[r.givenName, r.middleName, r.familyName, r.suffix].filter(Boolean).join(" ")}</Row>
            <Row term="Date of birth">{clinicalDate(`${r.birthDate}T12:00:00Z`)}</Row>
            <Row term="Sex">{SEX_LABEL[r.sex] ?? r.sex}</Row>
            {r.civilStatus ? <Row term="Civil status">{r.civilStatus}</Row> : null}
            <Row term="Mobile number">{mobile?.value ?? "—"}</Row>
            {email ? <Row term="Email">{email.value}</Row> : null}
            <Row term="Address">
              {address ? [address.line1, address.barangay, address.cityMunicipality, address.province, address.postalCode].filter(Boolean).join(", ") : "—"}
            </Row>
            {r.identifiers.map((i) => (
              <Row key={`${i.type}:${i.value}`} term={i.type === "philhealth_pin" ? "PhilHealth number" : i.type.replace(/_/g, " ")}>
                {i.value}
              </Row>
            ))}
            <Row term="Emergency contact">
              {r.emergencyContact.name} · {r.emergencyContact.contactNumber} ({r.emergencyContact.relationship})
            </Row>
          </dl>
        </Card>

        <Card className="p-4">
          <h2 className="flex items-center gap-2 text-section font-semibold">
            {hasCandidates ? <TriangleAlertIcon className="size-4 text-warning-foreground" aria-hidden /> : <UserCheckIcon className="size-4" aria-hidden />}
            {hasCandidates ? `Possible existing records (${candidates.length})` : "No existing record looks like this person"}
          </h2>
          {hasCandidates ? (
            <>
              <p className="mt-1 text-table text-muted-foreground">
                If this is one of them, link the registration to that record instead of creating a second one.
              </p>
              <ul className="mt-3 flex flex-col gap-2">{candidates.map(candidateCard)}</ul>
            </>
          ) : (
            <p className="mt-1 text-table text-muted-foreground">
              The Patient Master found no similar name, birth date or number. You can still search before approving.
            </p>
          )}
        </Card>
      </div>

      <aside aria-label="Decision" className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="flex items-center gap-2 text-section font-semibold">
            <ShieldCheckIcon className="size-4" aria-hidden /> Patient verification
          </h2>
          <label className="flex items-start gap-2 text-body">
            <Checkbox checked={verified} onCheckedChange={(v) => setVerified(v === true)} className="mt-0.5" />
            <span>I checked the person&apos;s identification against these details.</span>
          </label>
          <div className="grid gap-1">
            <Label htmlFor="identity-note">How was it checked? (optional)</Label>
            <Input
              id="identity-note"
              value={identityNote}
              maxLength={200}
              onChange={(e) => setIdentityNote(e.target.value)}
              placeholder="e.g. PhilHealth ID shown. Kept in the audit trail"
            />
          </div>

          {canApprove ? (
            <>
              {visitTypes.length > 0 ? (
                <div className="grid gap-1">
                  <Label htmlFor="visit-type">Put in the queue for</Label>
                  <NativeSelect id="visit-type" value={visitTypeId} placeholder="Do not queue yet" onChange={(e) => setVisitTypeId(e.target.value)}>
                    {visitTypes.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              {hasCandidates ? (
                <div className="flex flex-col gap-2 rounded-md border border-warning/40 p-2">
                  <label className="flex items-start gap-2 text-table">
                    <Checkbox checked={differentPerson} onCheckedChange={(v) => setDifferentPerson(v === true)} className="mt-0.5" />
                    <span>I looked at the possible matches and this is a different person.</span>
                  </label>
                  <Label htmlFor="override-reason">Why is this a different person? *</Label>
                  <Input
                    id="override-reason"
                    value={overrideReason}
                    maxLength={500}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Recorded in the audit trail"
                  />
                </div>
              ) : null}
              <Button
                disabled={pending || !verified || !overrideReady}
                onClick={() =>
                  run(
                    () =>
                      approveRegistration({
                        registrationId: detail.id,
                        identityChecked: true,
                        identityNote: identityNote.trim() || undefined,
                        visitTypeId: visitTypeId || undefined,
                        duplicateOverride: hasCandidates
                          ? { reviewedCandidateIds: candidates.map((c) => c.patient.id), reason: overrideReason.trim() }
                          : undefined,
                      }),
                    (data: { patientId: string; patientNumber: string; queued: boolean }) => {
                      toast.success(`Registered ${data.patientNumber}`);
                      if (visitTypeId && !data.queued)
                        toast.warning("The patient is registered but could not be put in the queue. Add them from the queue screen.");
                      setDone({ patientId: data.patientId, patientNumber: data.patientNumber, linked: false });
                    },
                  )
                }
              >
                <CheckCircle2Icon /> Approve and register
              </Button>
            </>
          ) : (
            <p className="text-table text-muted-foreground">You may check these details but not register patients.</p>
          )}
        </Card>

        <Card className="flex flex-col gap-2 p-4">
          {rejecting ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => rejectRegistration({ registrationId: detail.id, reason: rejectReason }),
                  () => {
                    toast.success("Registration declined");
                    router.push("/queue/registrations");
                  },
                );
              }}
            >
              <Label htmlFor="reject-reason">Why is it declined? *</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                maxLength={500}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Recorded in the audit trail"
              />
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" size="sm" disabled={pending || rejectReason.trim().length < 5}>
                  Decline registration
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)}>
                  Keep it
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setRejecting(true)} className="self-start">
              <XCircleIcon /> Decline…
            </Button>
          )}
        </Card>
      </aside>
    </div>
  );
}
