"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, MinusCircleIcon, PencilIcon } from "lucide-react";
import { Badge, Button, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, toast } from "@healthcare/ui/primitives";
import { createVaccine, setVaccineStatus, updateVaccine, type VaccineForm } from "@/app/(staff)/patients/immunization-actions";
import type { Vaccine } from "@/lib/api/types";

const EMPTY: VaccineForm = { name: "", productName: "", manufacturer: "", codeSystem: "", code: "", routes: "", sites: "", dosesInSeries: "" };

const toForm = (v: Vaccine): VaccineForm => ({
  name: v.name,
  productName: v.productName ?? "",
  manufacturer: v.manufacturer ?? "",
  codeSystem: v.codeSystem ?? "",
  code: v.code ?? "",
  routes: v.routes.join("\n"),
  sites: v.sites.join("\n"),
  dosesInSeries: v.dosesInSeries ? String(v.dosesInSeries) : "",
});

export function VaccineCatalog({ vaccines, canConfigure }: { vaccines: Vaccine[]; canConfigure: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Vaccine | null>(null);
  const [form, setForm] = React.useState<VaccineForm>(EMPTY);
  const [pending, startTransition] = React.useTransition();
  const set = (key: keyof VaccineForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = editing ? await updateVaccine(editing.id, form, editing.version) : await createVaccine(form);
      if (result.ok) {
        toast.success(editing ? `${result.data.name} updated` : `${result.data.name} added`);
        setEditing(null);
        setForm(EMPTY);
        router.refresh();
      } else toast.error(result.message);
    });
  };
  const toggle = (v: Vaccine) =>
    startTransition(async () => {
      const result = await setVaccineStatus(v.id, v.status === "active" ? "inactive" : "active", v.version);
      if (result.ok) {
        toast.success(`${v.name} ${result.data.status === "active" ? "is back in use" : "is no longer offered"}`);
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      {vaccines.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vaccine</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Routes · sites</TableHead>
              <TableHead>Doses in series</TableHead>
              <TableHead>Status</TableHead>
              {canConfigure ? <TableHead className="sr-only">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {vaccines.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  <span className="font-medium">{v.name}</span>
                  {v.productName ? <span className="text-muted-foreground"> · {v.productName}</span> : null}
                  {v.manufacturer ? <div className="text-meta text-muted-foreground">{v.manufacturer}</div> : null}
                </TableCell>
                <TableCell className="font-mono text-meta">{v.code ? `${v.codeSystem}|${v.code}` : "—"}</TableCell>
                <TableCell className="text-meta">{[v.routes.join(", "), v.sites.join(", ")].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="tabular-nums">{v.dosesInSeries ?? "—"}</TableCell>
                <TableCell>
                  {v.status === "active" ? (
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
                        setEditing(v);
                        setForm(toForm(v));
                      }}
                    >
                      <PencilIcon aria-hidden /> Edit
                    </Button>
                    <Button size="xs" variant="ghost" disabled={pending} onClick={() => toggle(v)}>
                      {v.status === "active" ? "Stop offering" : "Offer again"}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No vaccines yet.</p>
      )}
      {canConfigure ? (
        <form onSubmit={submit} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6" aria-label={editing ? "Edit vaccine" : "Add a vaccine"}>
          <h2 className="text-body font-semibold sm:col-span-6">{editing ? `Edit ${editing.name}` : "Add a vaccine"}</h2>
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor="vaccine-name">Name *</Label>
            <Input id="vaccine-name" maxLength={200} value={form.name} onChange={set("name")} />
          </div>
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor="vaccine-product">Product / brand</Label>
            <Input id="vaccine-product" maxLength={200} value={form.productName} onChange={set("productName")} />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="vaccine-manufacturer">Manufacturer</Label>
            <Input id="vaccine-manufacturer" maxLength={200} value={form.manufacturer} onChange={set("manufacturer")} />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="vaccine-code">Code</Label>
            <Input id="vaccine-code" maxLength={40} value={form.code} onChange={set("code")} />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="vaccine-code-system">Code system</Label>
            <Input id="vaccine-code-system" maxLength={40} placeholder="vaccine (your own list)" value={form.codeSystem} onChange={set("codeSystem")} />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="vaccine-routes">Routes (one per line)</Label>
            <Textarea id="vaccine-routes" rows={3} value={form.routes} onChange={set("routes")} />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="vaccine-sites">Sites (one per line)</Label>
            <Textarea id="vaccine-sites" rows={3} value={form.sites} onChange={set("sites")} />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="vaccine-doses">Doses in series (reference)</Label>
            <Input id="vaccine-doses" inputMode="numeric" maxLength={2} value={form.dosesInSeries} onChange={set("dosesInSeries")} />
          </div>
          <p className="text-meta text-muted-foreground sm:col-span-6">
            Codes are your organization&apos;s own unless you are licensed to use an official code set; name its code system here and configure its URI for
            exchange.
          </p>
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={pending || form.name.trim().length < 2}>
              {editing ? "Save changes" : "Add vaccine"}
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
      ) : (
        <p className="text-table text-muted-foreground">Only clinic administrators can change the catalogue.</p>
      )}
    </div>
  );
}
