"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { grantRole, resetStaffPassword, resetStaffTwoStep, revokeRole, setMembershipStatus } from "../actions";

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
          <NativeSelect placeholder="Choose…" id="grant-role" required value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="grant-facility">Where</Label>
          <NativeSelect
            emptyText="No facilities set up"
            id="grant-facility"
            value={form.facilityId}
            onChange={(e) => setForm((f) => ({ ...f, facilityId: e.target.value, departmentId: "" }))}
          >
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
            emptyText="No departments in this facility"
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

/**
 * Sign-in help for a member (user.manage, audited with a reason; their sessions end): a temporary password handed over
 * in person, to be replaced at the next sign-in, and turning off two-step verification after a lost phone. The API
 * refuses accounts also used in other organizations (a platform administrator resets those).
 */
export function SignInResets({ userId, mfaEnabled }: { userId: string; mfaEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<"password" | "two-step" | null>(null);
  const [form, setForm] = React.useState({ temporaryPassword: "", confirm: "", reason: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const close = () => {
    setOpen(null);
    setError(null);
    setForm({ temporaryPassword: "", confirm: "", reason: "" });
  };
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen("password")}>
          Reset password…
        </Button>
        {mfaEnabled ? (
          <Button size="sm" variant="outline" onClick={() => setOpen("two-step")}>
            Turn off two-step verification…
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = open === "password" ? await resetStaffPassword(userId, form) : await resetStaffTwoStep(userId, form.reason);
          if (result.ok) {
            toast.success(
              open === "password"
                ? "Temporary password set; they choose their own at the next sign-in"
                : "Two-step verification turned off; they can set it up again under My account",
            );
            close();
            router.refresh();
          } else setError(result.message);
        });
      }}
    >
      <p className="font-medium">{open === "password" ? "Reset password" : "Turn off two-step verification"}</p>
      {open === "password" ? (
        <>
          <p className="text-meta text-muted-foreground">
            Give the temporary password to the person directly, never by email or chat. They must choose their own password when they next sign in.
          </p>
          <Label htmlFor="temporary-password">Temporary password</Label>
          <Input
            id="temporary-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={form.temporaryPassword}
            onChange={set("temporaryPassword")}
          />
          <Label htmlFor="temporary-password-again">Temporary password again</Label>
          <Input id="temporary-password-again" type="password" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
        </>
      ) : (
        <p className="text-meta text-muted-foreground">
          For a lost or replaced phone. Their next sign-in asks only for the password; ask them to turn it on again under My account.
        </p>
      )}
      <Label htmlFor="reset-reason">Reason</Label>
      <Input
        id="reset-reason"
        required
        minLength={3}
        maxLength={500}
        placeholder="e.g. forgot password, confirmed in person"
        value={form.reason}
        onChange={set("reason")}
      />
      <p className="text-meta text-muted-foreground">They are signed out everywhere at once.</p>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {pending ? "Saving…" : open === "password" ? "Set temporary password" : "Turn off"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
