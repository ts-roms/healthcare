"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlusIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, toast } from "@healthcare/ui/primitives";
import { addStaffMember } from "./actions";

/** Adds a person to the organization. A new email also gets an account with a first password to hand over in person. */
export function AddStaffMember() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({ email: "", displayName: "", initialPassword: "" });
  const [error, setError] = React.useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlusIcon aria-hidden /> Add staff member
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add staff member</DialogTitle>
            <DialogDescription>
              They can sign in once they have a role. Someone who already has an account on the platform keeps their own password.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const result = await addStaffMember(form);
                if (result.ok) {
                  toast.success(`${result.data.displayName} added — now give them a role`);
                  setOpen(false);
                  setForm({ email: "", displayName: "", initialPassword: "" });
                  router.push(`/admin/users/${result.data.id}`);
                } else if (result.code === "initial_password_required") {
                  setError("This email has no account yet: set a first password for them.");
                } else setError(result.message);
              });
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="staff-email">Work email</Label>
              <Input id="staff-email" type="email" autoComplete="off" required value={form.email} onChange={set("email")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="staff-name">Name to show</Label>
              <Input id="staff-name" required maxLength={200} value={form.displayName} onChange={set("displayName")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="staff-password">First password (new accounts only)</Label>
              <Input
                id="staff-password"
                type="password"
                autoComplete="new-password"
                maxLength={128}
                value={form.initialPassword}
                onChange={set("initialPassword")}
                aria-describedby="staff-password-hint"
              />
              <p id="staff-password-hint" className="text-meta text-muted-foreground">
                At least 12 characters. Give it to them in person; they change it under My account after signing in.
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-table text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Adding…" : "Add"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
