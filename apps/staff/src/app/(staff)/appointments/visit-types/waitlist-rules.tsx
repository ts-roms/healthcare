"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ListChecksIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import type { Practitioner, VisitType, WaitlistRule } from "@/lib/api/types";
import { saveWaitlistRule } from "../actions";

/**
 * Waiting-list rules per visit type or practitioner at the selected facility (migration 0096): whether patients may
 * join, how many requests, how far ahead. The facility's own rule (above) applies to everything without one; a
 * practitioner's rule wins over a visit type's. The API validates and audits.
 */
export function WaitlistRules({
  facilityId,
  facilityName,
  rules,
  visitTypes,
  practitioners,
  canConfigure,
}: {
  facilityId: string;
  facilityName: string;
  rules: WaitlistRule[];
  visitTypes: VisitType[];
  practitioners: Practitioner[];
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = React.useState<"visit_type" | "practitioner">("visit_type");
  const [targetId, setTargetId] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [maxEntries, setMaxEntries] = React.useState("3");
  const [maxDaysAhead, setMaxDaysAhead] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const existing = rules.find((r) => r.scope === scope && (scope === "visit_type" ? r.visitTypeId : r.practitionerId) === targetId);
  const choose = (nextScope: "visit_type" | "practitioner", id: string) => {
    setScope(nextScope);
    setTargetId(id);
    const rule = rules.find((r) => r.scope === nextScope && (nextScope === "visit_type" ? r.visitTypeId : r.practitionerId) === id);
    setEnabled(rule?.enabled ?? true);
    setMaxEntries(String(rule?.maxEntries ?? 3));
    setMaxDaysAhead(rule?.maxDaysAhead ? String(rule.maxDaysAhead) : "");
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveWaitlistRule({
        facilityId,
        scope,
        ...(scope === "visit_type" ? { visitTypeId: targetId } : { practitionerId: targetId }),
        enabled,
        maxEntries: Number(maxEntries),
        maxDaysAhead: maxDaysAhead.trim() ? Number(maxDaysAhead) : null,
        version: existing?.version ?? null,
      });
      if (result.ok) {
        toast.success("Waiting-list rule saved");
        router.refresh();
      } else toast.error(result.message);
    });
  };
  return (
    <div className="flex flex-col gap-4 p-4 pt-0">
      <Card>
        <CardHeader>
          <ListChecksIcon className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Waiting-list rules per visit type or practitioner — {facilityName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-table text-muted-foreground">
            The clinic&apos;s own waiting-list rule above applies to everything without a rule here. A practitioner&apos;s rule wins over a visit type&apos;s.
          </p>
          {rules.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>For</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead>Per patient</TableHead>
                  <TableHead>Up to (days ahead)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-medium">
                        {r.scope === "visit_type" ? (r.visitTypeName ?? "Visit type") : (r.practitionerName ?? "Practitioner")}
                      </span>
                      <span className="block text-meta text-muted-foreground">{r.scope === "visit_type" ? "Visit type" : "Practitioner"}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.enabled ? "success" : "neutral"}>{r.enabled ? "Taken" : "Not taken"}</Badge>
                    </TableCell>
                    <TableCell className="text-meta">{r.maxEntries}</TableCell>
                    <TableCell className="text-meta">{r.maxDaysAhead ?? "The clinic's horizon"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-table text-muted-foreground">No rule per visit type or practitioner yet.</p>
          )}
          {canConfigure ? (
            <form onSubmit={submit} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Set a waiting-list rule">
              <div className="flex flex-col gap-1">
                <Label htmlFor="wl-scope">Rule for</Label>
                <NativeSelect id="wl-scope" value={scope} onChange={(e) => choose(e.target.value as "visit_type" | "practitioner", "")}>
                  <option value="visit_type">A visit type</option>
                  <option value="practitioner">A practitioner</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="wl-target">{scope === "visit_type" ? "Visit type" : "Practitioner"} *</Label>
                <NativeSelect
                  id="wl-target"
                  placeholder="Choose…"
                  emptyText={scope === "visit_type" ? "No visit types set up" : "No practitioners set up"}
                  value={targetId}
                  onChange={(e) => choose(scope, e.target.value)}
                >
                  {scope === "visit_type"
                    ? visitTypes.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))
                    : practitioners
                        .filter((p) => p.status === "active")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                          </option>
                        ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="wl-max">Requests per patient</Label>
                <Input id="wl-max" type="number" min={1} max={10} value={maxEntries} onChange={(e) => setMaxEntries(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="wl-days">Up to (days ahead)</Label>
                <Input
                  id="wl-days"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="The clinic's horizon"
                  value={maxDaysAhead}
                  onChange={(e) => setMaxDaysAhead(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-body sm:col-span-2">
                <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} aria-label="Patients may join the waiting list" />
                Patients may ask to be told when a time opens
              </label>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" size="sm" disabled={pending || !targetId}>
                  {existing ? "Save rule" : "Add rule"}
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
