"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { grantRole, revokeRole, setMembershipStatus } from "../actions";

interface Option {
  id: string;
  name: string;
}

/** Grant a role organization-wide, at one facility, or in one department of a facility. */
export function GrantRoleForm({
  userId,
  roles,
  facilities,
  departments,
  withheld,
}: {
  userId: string;
  roles: Option[];
  facilities: Option[];
  departments: Array<Option & { facilityId: string }>;
  withheld: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({ roleId: "", facilityId: "", departmentId: "" });
  const inFacility = departments.filter((d) => d.facilityId === form.facilityId);
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await grantRole(userId, form);
          if (result.ok) {
            toast.success("Role granted");
            setForm({ roleId: "", facilityId: "", departmentId: "" });
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <p className="font-medium">Grant a role</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="grant-role">Role</Label>
          <NativeSelect id="grant-role" required value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
            <option value="">Choose…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="grant-facility">Where</Label>
          <NativeSelect id="grant-facility" value={form.facilityId} onChange={(e) => setForm((f) => ({ ...f, facilityId: e.target.value, departmentId: "" }))}>
            <option value="">Organization-wide</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="grant-department">Department</Label>
          <NativeSelect
            id="grant-department"
            disabled={!form.facilityId || inFacility.length === 0}
            value={form.departmentId}
            onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
          >
            <option value="">Whole facility</option>
            {inFacility.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {withheld > 0 ? (
        <p className="text-meta text-muted-foreground">
          {withheld} role{withheld === 1 ? "" : "s"} not listed: they include permissions you do not hold yourself.
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending || !form.roleId} className="self-start">
        {pending ? "Granting…" : "Grant"}
      </Button>
    </form>
  );
}

/** Revoking a role needs a reason, recorded in the audit trail. */
export function RevokeRoleButton({ userId, assignmentId, roleName }: { userId: string; assignmentId: string; roleName: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(true)}>
        Revoke…
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await revokeRole(userId, assignmentId, reason);
          if (result.ok) {
            toast.success(`${roleName} revoked`);
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid min-w-64 flex-1 gap-1">
        <Label htmlFor={`revoke-${assignmentId}`}>Why revoke {roleName}?</Label>
        <Input id={`revoke-${assignmentId}`} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </Button>
    </form>
  );
}

/** Suspending ends the person's sessions at once; reactivating lets them sign in again. Both need a reason. */
export function MembershipControl({ userId, status }: { userId: string; status: "active" | "suspended" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const next = status === "active" ? "suspended" : "active";
  const verb = status === "active" ? "Suspend" : "Reactivate";
  if (!open) {
    return (
      <Button size="sm" variant={status === "active" ? "outline" : "default"} className="self-start" onClick={() => setOpen(true)}>
        {verb}…
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await setMembershipStatus(userId, next, reason);
          if (result.ok) {
            toast.success(next === "suspended" ? "Suspended; their sessions have ended" : "Reactivated");
            setOpen(false);
            setReason("");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <Label htmlFor="membership-reason">Reason</Label>
      <Input id="membership-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      {next === "suspended" ? <p className="text-meta text-muted-foreground">They are signed out everywhere at once.</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={next === "suspended" ? "destructive" : "default"} disabled={pending}>
          {pending ? "Saving…" : verb}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
