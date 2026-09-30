"use client";

import * as React from "react";
import Link from "next/link";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Checkbox, Input, Label, NativeSelect, Textarea } from "@healthcare/ui/primitives";
import type { StaffProxyGrant, StaffProxyOverview } from "@/lib/api/types";
import { grantProxy, revokeProxy } from "./proxy-actions";

const RELATIONSHIPS = [
  ["parent", "Parent"],
  ["legal_guardian", "Legal guardian"],
  ["caregiver", "Caregiver"],
  ["spouse_or_partner", "Spouse or partner"],
  ["adult_child", "Adult child"],
  ["other", "Other"],
] as const;
const BASES = [
  ["parent_of_minor", "Parent of a minor"],
  ["legal_guardian", "Legal guardian"],
  ["authorized_by_patient", "Authorized by the patient"],
  ["other_authorized", "Other authority, as noted"],
] as const;
const label = (list: readonly (readonly [string, string])[], key: string) => list.find(([k]) => k === key)?.[1] ?? key;

/**
 * Guardian access to MyHealth for one patient: who may act for them, whom they may act for, and giving or ending access.
 * The clinic records what it checked; the platform decides nothing about who has the right to act. The API enforces
 * permission and the rules (the guardian's own account, the patient's portal consent).
 */
export function ProxyAccess({ patientId, overview, canManage }: { patientId: string; overview: StaffProxyOverview; canManage: boolean }) {
  const [adding, setAdding] = React.useState(false);
  const [ending, setEnding] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [form, setForm] = React.useState({
    guardianPatientNumber: "",
    relationship: "parent",
    basis: "parent_of_minor",
    canAct: true,
    verificationNote: "",
    expiresOn: "",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const result = await grantProxy(patientId, form);
      if (result.ok) {
        setAdding(false);
        setForm({ ...form, guardianPatientNumber: "", verificationNote: "", expiresOn: "" });
      } else setError(result.message);
    });
  };
  const end = (event: React.FormEvent, grantId: string) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const result = await revokeProxy(patientId, grantId, reason);
      if (result.ok) {
        setEnding(null);
        setReason("");
      } else setError(result.message);
    });
  };

  const row = (g: StaffProxyGrant, other: "guardian" | "dependent") => {
    const name = other === "guardian" ? g.guardianName : g.dependentName;
    const number = other === "guardian" ? g.guardianNumber : g.dependentNumber;
    const id = other === "guardian" ? g.guardianPatientId : g.dependentPatientId;
    return (
      <li key={g.id} className="flex flex-col gap-1 rounded-lg border p-3 text-table">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/patients/${id}`} className="font-medium text-primary hover:underline">
            {name}
          </Link>
          <span className="text-muted-foreground">{number}</span>
          <Badge variant={g.live ? "success" : "neutral"}>{g.live ? "Active" : g.revokedAt ? "Ended" : "Expired"}</Badge>
        </div>
        <p className="text-muted-foreground">
          {label(RELATIONSHIPS, g.relationship)} · {label(BASES, g.basis)} · {g.scopes.includes("act") ? "sees and acts" : "view only"}
          {g.expiresAt ? ` · until ${clinicalDateTime(g.expiresAt)}` : ""}
        </p>
        <p className="text-muted-foreground">
          Checked: {g.verificationNote} · recorded {clinicalDateTime(g.grantedAt)}
          {g.grantedByName ? ` by ${g.grantedByName}` : ""}
        </p>
        {g.revokedAt ? (
          <p className="text-muted-foreground">
            Ended {clinicalDateTime(g.revokedAt)}
            {g.revokedBy === "patient" ? " in MyHealth" : ""}: {g.revokedReason}
          </p>
        ) : null}
        {g.live && canManage && other === "guardian" ? (
          ending === g.id ? (
            <form onSubmit={(e) => end(e, g.id)} className="mt-1 flex flex-col gap-2">
              <Label htmlFor={`end-${g.id}`}>Why does this access end?</Label>
              <Textarea id={`end-${g.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required minLength={3} maxLength={500} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="destructive" disabled={pending}>
                  End access
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEnding(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setEnding(g.id)}>
              End access
            </Button>
          )
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-section font-semibold">Guardians and caregivers</h3>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      {overview.actedForBy.length === 0 ? (
        <p className="text-body text-muted-foreground">No one else can act for this patient in MyHealth.</p>
      ) : (
        <ul className="flex flex-col gap-2">{overview.actedForBy.map((g) => row(g, "guardian"))}</ul>
      )}
      {overview.actingFor.length > 0 ? (
        <>
          <p className="text-body font-medium">Acts for</p>
          <ul className="flex flex-col gap-2">{overview.actingFor.map((g) => row(g, "dependent"))}</ul>
        </>
      ) : null}
      {canManage ? (
        adding ? (
          <form onSubmit={add} className="flex flex-col gap-3 rounded-lg border p-3">
            <p className="text-meta text-muted-foreground">
              Check the person&apos;s identity and their right to act by the clinic&apos;s own procedure first. They need their own active MyHealth account, and
              this patient&apos;s MyHealth consent must be recorded (given by the guardian for a child).
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="proxy-number">Guardian&apos;s patient number</Label>
              <Input
                id="proxy-number"
                value={form.guardianPatientNumber}
                onChange={(e) => setForm({ ...form, guardianPatientNumber: e.target.value })}
                placeholder="P00000123"
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="proxy-rel">Relationship</Label>
                <NativeSelect id="proxy-rel" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
                  {RELATIONSHIPS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="proxy-basis">Right to act</Label>
                <NativeSelect id="proxy-basis" value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}>
                  {BASES.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="proxy-note">What was checked</Label>
              <Textarea
                id="proxy-note"
                value={form.verificationNote}
                onChange={(e) => setForm({ ...form, verificationNote: e.target.value })}
                rows={2}
                required
                minLength={5}
                maxLength={500}
                placeholder="Documents seen, who verified. No clinical detail."
              />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-body">
                <Checkbox checked={form.canAct} onCheckedChange={(v) => setForm({ ...form, canAct: v === true })} />
                May also make changes (book, message, request records), not only look
              </label>
              <div className="flex flex-col gap-1">
                <Label htmlFor="proxy-until">Ends on (optional)</Label>
                <Input id="proxy-until" type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                Give access
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAdding(true)}>
            Add a guardian or caregiver…
          </Button>
        )
      ) : null}
    </div>
  );
}
