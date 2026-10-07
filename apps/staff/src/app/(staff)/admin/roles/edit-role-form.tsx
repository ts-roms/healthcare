"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { Button, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { StaffRoleDefinition } from "@/lib/api/types";
import { updateRole } from "../users/actions";
import { PermissionPicker } from "./permission-picker";

/**
 * Edits one of the organization's own roles (migration 0102): name, description and the whole permission set, saved
 * together with the version the screen loaded. The key never changes. Permissions the editor does not hold stay as they
 * are (the API refuses adding or removing them). Holders see the change at their next request.
 */
export function EditRoleForm({ role, groups, held }: { role: StaffRoleDefinition; groups: Array<{ area: string; permissions: string[] }>; held: string[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({ name: role.name, description: role.description ?? "", reason: "" });
  const [chosen, setChosen] = React.useState<Set<string>>(new Set(role.permissions));
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <PencilIcon aria-hidden /> Edit…
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
      className="flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateRole(role.id, { ...form, permissions: [...chosen] }, role.version);
          if (result.ok) {
            toast.success(`${result.data.name} updated; holders see the change at their next page`);
            setOpen(false);
            setForm((f) => ({ ...f, reason: "" }));
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <p className="text-meta text-muted-foreground">
        Key <code>{role.key}</code> cannot change. People holding this role keep it; what it allows changes for all of them at once.
      </p>
      <div className="grid gap-1">
        <Label htmlFor={`edit-${role.id}-name`}>Name</Label>
        <Input id={`edit-${role.id}-name`} required maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`edit-${role.id}-description`}>Description (optional)</Label>
        <Textarea
          id={`edit-${role.id}-description`}
          rows={2}
          maxLength={500}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>
      <PermissionPicker idPrefix={`edit-${role.id}`} groups={groups} held={held} chosen={chosen} onToggle={toggle} />
      <div className="grid gap-1">
        <Label htmlFor={`edit-${role.id}-reason`}>Reason (optional, kept in the audit trail)</Label>
        <Input id={`edit-${role.id}-reason`} maxLength={500} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || chosen.size === 0}>
          {pending ? "Saving…" : "Save role"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setForm({ name: role.name, description: role.description ?? "", reason: "" });
            setChosen(new Set(role.permissions));
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
