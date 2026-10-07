"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, MinusCircleIcon, PencilIcon } from "lucide-react";
import { Badge, Button, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@healthcare/ui/primitives";
import type { CodingSystem } from "@/lib/api/types";
import { createCodingSystem, setCodingSystemStatus, updateCodingSystem } from "../coding-actions";

const EMPTY = { key: "", name: "", version: "" };

export function CodingSystems({ systems, canConfigure }: { systems: CodingSystem[]; canConfigure: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<CodingSystem | null>(null);
  const [form, setForm] = React.useState(EMPTY);
  const [pending, startTransition] = React.useTransition();
  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = editing ? await updateCodingSystem(editing.id, { name: form.name, version: form.version }) : await createCodingSystem(form);
      if (result.ok) {
        toast.success(editing ? `${result.data.name} updated` : `${result.data.name} registered`);
        setEditing(null);
        setForm(EMPTY);
        router.refresh();
      } else toast.error(result.message);
    });
  };
  const toggle = (s: CodingSystem) =>
    startTransition(async () => {
      const result = await setCodingSystemStatus(s.id, s.status === "active" ? "inactive" : "active");
      if (result.ok) {
        toast.success(`${s.name} ${result.data.status === "active" ? "is offered again" : "is no longer offered for new diagnoses"}`);
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      {systems.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Edition</TableHead>
              <TableHead>Status</TableHead>
              {canConfigure ? <TableHead className="sr-only">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {systems.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-meta">{s.key}</TableCell>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.version ?? "—"}</TableCell>
                <TableCell>
                  {s.status === "active" ? (
                    <Badge variant="success">
                      <CheckCircle2Icon aria-hidden /> In use
                    </Badge>
                  ) : (
                    <Badge variant="neutral">
                      <MinusCircleIcon aria-hidden /> Not offered
                    </Badge>
                  )}
                </TableCell>
                {canConfigure ? (
                  <TableCell className="flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setEditing(s);
                        setForm({ key: s.key, name: s.name, version: s.version ?? "" });
                      }}
                    >
                      <PencilIcon aria-hidden /> Edit
                    </Button>
                    <Button size="xs" variant="ghost" disabled={pending} onClick={() => toggle(s)}>
                      {s.status === "active" ? "Stop offering" : "Offer again"}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No coding system yet: diagnoses are recorded as text until one is registered.</p>
      )}
      {canConfigure ? (
        <form
          onSubmit={submit}
          className="grid gap-2 rounded-md border p-3 sm:grid-cols-6"
          aria-label={editing ? "Edit coding system" : "Register a coding system"}
        >
          <h2 className="text-body font-semibold sm:col-span-6">{editing ? `Edit ${editing.name}` : "Register a coding system"}</h2>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="cs-key">Key *</Label>
            <Input id="cs-key" maxLength={49} placeholder="e.g. icd-10" value={form.key} onChange={set("key")} disabled={editing !== null} required />
            <p className="text-meta text-muted-foreground">How diagnoses name it; cannot change later.</p>
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="cs-name">Name *</Label>
            <Input id="cs-name" maxLength={120} placeholder="e.g. ICD-10" value={form.name} onChange={set("name")} required />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="cs-version">Edition (optional)</Label>
            <Input id="cs-version" maxLength={40} placeholder="e.g. 2019" value={form.version} onChange={set("version")} />
          </div>
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Register"}
            </Button>
            {editing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setForm(EMPTY);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
