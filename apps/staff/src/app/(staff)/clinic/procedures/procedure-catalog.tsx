"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, MinusCircleIcon, PencilIcon } from "lucide-react";
import { Badge, Button, Checkbox, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@healthcare/ui/primitives";
import { createProcedureDefinition, updateProcedureDefinition } from "@/app/(staff)/clinic/procedure-actions";
import type { ProcedureDefinition } from "@/lib/api/types";
import { BLANK_DEFINITION_FORM, type DefinitionForm } from "@/lib/procedure-form";

const toForm = (d: ProcedureDefinition): DefinitionForm => ({
  code: d.code,
  name: d.name,
  codeSystem: d.codeSystem ?? "",
  externalCode: d.externalCode ?? "",
  requiresBodySite: d.requiresBodySite,
});

export function ProcedureCatalog({ definitions, canConfigure }: { definitions: ProcedureDefinition[]; canConfigure: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ProcedureDefinition | null>(null);
  const [form, setForm] = React.useState<DefinitionForm>(BLANK_DEFINITION_FORM);
  const [pending, startTransition] = React.useTransition();
  const set = (key: "code" | "name" | "codeSystem" | "externalCode") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const reset = () => {
    setEditing(null);
    setForm(BLANK_DEFINITION_FORM);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = editing
        ? await updateProcedureDefinition({
            id: editing.id,
            version: editing.version,
            name: form.name,
            codeSystem: form.externalCode?.trim() ? form.codeSystem : null,
            externalCode: form.externalCode?.trim() ? form.externalCode : null,
            requiresBodySite: form.requiresBodySite,
          })
        : await createProcedureDefinition(form);
      if (result.ok) {
        toast.success(editing ? `${result.data.name} updated` : `${result.data.name} added`);
        reset();
        router.refresh();
      } else toast.error(result.message);
    });
  };
  const toggle = (d: ProcedureDefinition) =>
    startTransition(async () => {
      const result = await updateProcedureDefinition({ id: d.id, version: d.version, status: d.status === "active" ? "inactive" : "active" });
      if (result.ok) {
        toast.success(`${d.name} ${result.data.status === "active" ? "is back in use" : "is no longer offered"}`);
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      {definitions.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Procedure</TableHead>
              <TableHead>Other code</TableHead>
              <TableHead>Body site</TableHead>
              <TableHead>Status</TableHead>
              {canConfigure ? <TableHead className="sr-only">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {definitions.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-meta">{d.code}</TableCell>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell className="font-mono text-meta">{d.externalCode ? `${d.codeSystem}|${d.externalCode}` : "—"}</TableCell>
                <TableCell className="text-meta">{d.requiresBodySite ? "Asked when recording" : "Optional"}</TableCell>
                <TableCell>
                  {d.status === "active" ? (
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
                        setEditing(d);
                        setForm(toForm(d));
                      }}
                    >
                      <PencilIcon aria-hidden /> Edit
                    </Button>
                    <Button size="xs" variant="ghost" disabled={pending} onClick={() => toggle(d)}>
                      {d.status === "active" ? "Stop offering" : "Offer again"}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No procedures yet.</p>
      )}
      {canConfigure ? (
        <form onSubmit={submit} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6" aria-label={editing ? "Edit procedure" : "Add a procedure"}>
          <h2 className="text-body font-semibold sm:col-span-6">{editing ? `Edit ${editing.name}` : "Add a procedure"}</h2>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="procedure-code">Code *</Label>
            <Input id="procedure-code" maxLength={30} value={form.code} onChange={set("code")} disabled={Boolean(editing)} placeholder="e.g. SUT-S" />
            {editing ? <span className="text-meta text-muted-foreground">A code never changes; stop offering this entry and add another instead.</span> : null}
          </div>
          <div className="grid gap-1 sm:col-span-4">
            <Label htmlFor="procedure-name">Name *</Label>
            <Input id="procedure-name" maxLength={200} value={form.name} onChange={set("name")} placeholder="e.g. Suture repair, simple" />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="procedure-code-system">Other code system</Label>
            <Input id="procedure-code-system" maxLength={40} value={form.codeSystem} onChange={set("codeSystem")} placeholder="your key, e.g. rvs" />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="procedure-external-code">Other code</Label>
            <Input id="procedure-external-code" maxLength={40} value={form.externalCode} onChange={set("externalCode")} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 sm:self-end">
            <Checkbox
              id="procedure-body-site"
              checked={form.requiresBodySite}
              onCheckedChange={(v) => setForm((f) => ({ ...f, requiresBodySite: v === true }))}
            />
            <Label htmlFor="procedure-body-site">Ask for the body site</Label>
          </div>
          <p className="text-meta text-muted-foreground sm:col-span-6">
            Codes are your organization&apos;s own. If you also use another code set (for example a relative value scale edition you are licensed to use), name
            it with your own key and configure its URI for exchange; none is assumed.
          </p>
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={pending || form.name.trim().length < 2 || !form.code.trim()}>
              {editing ? "Save changes" : "Add procedure"}
            </Button>
            {editing ? (
              <Button type="button" size="sm" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="text-table text-muted-foreground">Only clinic administrators can change the catalogue.</p>
      )}
    </div>
  );
}
