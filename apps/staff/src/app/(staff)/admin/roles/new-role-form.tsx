"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import { createRole } from "../users/actions";
import { PermissionPicker } from "./permission-picker";

/** A new organization role. Only permissions the administrator holds can be chosen (the API enforces the same). */
export function NewRoleForm({ groups, held }: { groups: Array<{ area: string; permissions: string[] }>; held: string[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({ key: "", name: "", description: "" });
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  if (!open) {
    return (
      <Button size="sm" className="self-start" onClick={() => setOpen(true)}>
        New role…
      </Button>
    );
  }
  const toggle = (permission: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(permission);
      else next.delete(permission);
      return next;
    });
  return (
    <form
      className="flex flex-col gap-3 rounded-md border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createRole({ ...form, permissions: [...chosen] });
          if (result.ok) {
            toast.success(`${result.data.name} created`);
            setOpen(false);
            setForm({ key: "", name: "", description: "" });
            setChosen(new Set());
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="role-name">Name</Label>
          <Input id="role-name" required maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="role-key">Key</Label>
          <Input
            id="role-key"
            required
            placeholder="e.g. front_desk_lead"
            pattern="[a-z][a-z0-9_]{1,48}"
            value={form.key}
            onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toLowerCase() }))}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="role-description">Description (optional)</Label>
        <Textarea
          id="role-description"
          rows={2}
          maxLength={500}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>
      <PermissionPicker idPrefix="perm" groups={groups} held={held} chosen={chosen} onToggle={toggle} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || chosen.size === 0}>
          {pending ? "Creating…" : "Create role"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
