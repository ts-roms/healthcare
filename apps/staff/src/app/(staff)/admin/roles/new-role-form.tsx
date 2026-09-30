"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import { createRole } from "../users/actions";

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
      <fieldset className="flex flex-col gap-2">
        <legend className="text-table font-medium">Permissions ({chosen.size} chosen)</legend>
        <p className="text-meta text-muted-foreground">Greyed-out permissions are ones you do not hold; you cannot hand them out.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <div key={group.area} className="rounded-md border p-2">
              <p className="mb-1 text-meta font-medium text-muted-foreground uppercase">{group.area}</p>
              {group.permissions.map((permission) => {
                const id = `perm-${permission}`;
                const allowed = held.includes(permission);
                return (
                  <div key={permission} className="flex items-center gap-2 py-0.5">
                    <Checkbox id={id} disabled={!allowed} checked={chosen.has(permission)} onCheckedChange={(v) => toggle(permission, v === true)} />
                    <Label htmlFor={id} className={allowed ? "font-mono text-meta" : "font-mono text-meta text-muted-foreground"}>
                      {permission}
                    </Label>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </fieldset>
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
