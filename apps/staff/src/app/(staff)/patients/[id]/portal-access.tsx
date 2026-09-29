"use client";

import * as React from "react";
import { AlertTriangleIcon, BanIcon, KeyRoundIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Label, Textarea } from "@healthcare/ui/primitives";
import type { PortalAccountStatus, PortalInvitation } from "@/lib/api/types";
import { disablePortal, invitePortal } from "./portal-actions";

interface PortalAccessProps {
  patientId: string;
  patientNumber: string;
  account: PortalAccountStatus;
  canManage: boolean;
  patientActive: boolean;
}

/**
 * Patient portal access for one patient: status, invitation (one-time code,
 * shown once) and disabling. The API enforces permission, consent and state;
 * this only decides which buttons are worth showing.
 */
export function PortalAccess({ patientId, patientNumber, account, canManage, patientActive }: PortalAccessProps) {
  const [invitation, setInvitation] = React.useState<PortalInvitation | null>(null);
  const [disabling, setDisabling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const canInvite = canManage && patientActive && account.portalConsent && account.status !== "active";
  const canDisable = canManage && (account.status === "active" || account.status === "invited");

  const invite = () =>
    startTransition(async () => {
      setError(null);
      const result = await invitePortal(patientId);
      if (result.ok) setInvitation(result.value);
      else setError(result.message);
    });

  const disable = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const result = await disablePortal(patientId, reason);
      if (result.ok) {
        setDisabling(false);
        setReason("");
        setInvitation(null);
      } else setError(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-3 text-body">
      <StatusLine account={account} />

      {!account.portalConsent ? (
        <p className="flex items-start gap-1.5 text-table text-warning-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {account.status === "active"
            ? "Portal access consent is not in effect, so the patient cannot sign in."
            : "Record the patient's portal access consent (under Consent & communication) before inviting them."}
        </p>
      ) : null}

      {invitation ? (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary-subtle p-3">
          <p className="font-medium">Activation code — shown only once</p>
          <p className="font-mono text-page font-semibold tracking-[0.2em] select-all">{invitation.activationCode}</p>
          <p className="text-table text-muted-foreground">
            Give it to the patient in person after checking their identity. They set up their account in MyHealth with patient number{" "}
            <span className="font-mono">{patientNumber}</span>, their date of birth and this code. Expires {clinicalDateTime(invitation.expiresAt)}.
          </p>
          <Button variant="outline" size="sm" className="self-start" onClick={() => setInvitation(null)}>
            Done — hide code
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-table text-danger-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {disabling ? (
        <form onSubmit={disable} className="flex flex-col gap-2 rounded-md border p-3">
          <Label htmlFor="portal-disable-reason">Reason for disabling</Label>
          <Textarea
            id="portal-disable-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
            maxLength={500}
            required
            placeholder="e.g. Patient request; lost phone"
          />
          <p className="text-meta text-muted-foreground">The patient is signed out everywhere. The reason is kept in the audit trail.</p>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={pending || reason.trim().length < 5}>
              <BanIcon aria-hidden /> {pending ? "Disabling…" : "Disable portal access"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDisabling(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : canInvite || canDisable ? (
        <div className="flex flex-wrap gap-2">
          {canInvite ? (
            <Button size="sm" onClick={invite} disabled={pending}>
              <KeyRoundIcon aria-hidden /> {pending ? "Issuing…" : account.status === "none" ? "Invite to portal" : "Issue new code"}
            </Button>
          ) : null}
          {canDisable ? (
            <Button variant="outline" size="sm" onClick={() => setDisabling(true)} disabled={pending}>
              <BanIcon aria-hidden /> Disable access
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusLine({ account }: { account: PortalAccountStatus }) {
  switch (account.status) {
    case "none":
      return <p className="text-muted-foreground">No portal account.</p>;
    case "invited": {
      const expired = account.invitationExpired;
      return (
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant={expired ? "warning" : "info"}>{expired ? "Invitation expired" : "Invited"}</Badge>
          {account.activationExpiresAt && !expired ? (
            <span className="text-muted-foreground">Code expires {clinicalDateTime(account.activationExpiresAt)}</span>
          ) : (
            <span className="text-muted-foreground">The code can no longer be used. Issue a new code for the patient to sign up.</span>
          )}
          <ActivationFailure account={account} />
        </p>
      );
    }
    case "active":
      return (
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Active</Badge>
          <span>{account.email}</span>
          <span className="text-muted-foreground">· last sign-in {account.lastLoginAt ? clinicalDateTime(account.lastLoginAt) : "never"}</span>
        </p>
      );
    case "disabled":
      return (
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Disabled</Badge>
          {account.disabledAt ? <span className="text-muted-foreground">{clinicalDateTime(account.disabledAt)}</span> : null}
          {account.disabledReason ? <span>— {account.disabledReason}</span> : null}
        </p>
      );
  }
}

const ACTIVATION_FAILURE_TEXT: Record<NonNullable<PortalAccountStatus["lastActivationFailure"]>["reason"], string> = {
  expired: "the code had already expired",
  birth_date_mismatch: "the date of birth did not match the patient record",
  code_mismatch: "the activation code was wrong (only the latest code issued works)",
};

/**
 * Why the patient's latest sign-up attempt failed. Shown to staff only: the patient is always
 * told the same thing, so the activation page cannot confirm patient numbers or birth dates.
 */
function ActivationFailure({ account }: { account: PortalAccountStatus }) {
  const failure = account.lastActivationFailure;
  if (!failure) return null;
  const attempts = failure.reason === "expired" ? null : `${account.failedActivationAttempts} of ${account.maxActivationAttempts} wrong attempts`;
  return (
    <span className="flex basis-full items-start gap-1.5 text-table text-warning-foreground">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Last sign-up attempt {clinicalDateTime(failure.at)} failed: {ACTIVATION_FAILURE_TEXT[failure.reason]}
        {attempts ? ` · ${attempts}` : ""}.
      </span>
    </span>
  );
}
