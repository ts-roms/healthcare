"use client";

import * as React from "react";
import { CircleCheckIcon, CircleOffIcon, PencilIcon, PlusIcon } from "lucide-react";
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
  Textarea,
} from "@healthcare/ui/primitives";
import type { CodingSystem, LabOrderSet, LabPanel, LabTest, VisitType } from "@/lib/api/types";
import { describeTriggers, formValues, parsePrefixes, triggersFrom } from "@/lib/order-set-form";
import { useServerAction } from "@/lib/use-server-action";
import { createOrderSet, updateOrderSet } from "./actions";

type Choice = { kind: "test" | "panel"; id: string };

export function OrderSetsManager({
  sets,
  tests,
  panels,
  visitTypes,
  codingSystems,
}: {
  sets: LabOrderSet[];
  tests: LabTest[];
  panels: LabPanel[];
  /** null: the person may not read visit types. */
  visitTypes: VisitType[] | null;
  codingSystems: CodingSystem[] | null;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const visitTypeName = (code: string) => visitTypes?.find((v) => v.code === code)?.name ?? code;
  const systemName = (key: string) => codingSystems?.find((c) => c.key === key)?.name ?? key;
  const current = editing && editing !== "new" ? (sets.find((s) => s.id === editing) ?? null) : null;

  return (
    <div className="grid gap-4">
      {editing ? (
        <OrderSetForm
          key={editing}
          set={current}
          tests={tests}
          panels={panels}
          visitTypes={visitTypes}
          codingSystems={codingSystems}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Button size="sm" className="justify-self-start" onClick={() => setEditing("new")} disabled={tests.length === 0 && panels.length === 0}>
          <PlusIcon /> New order set
        </Button>
      )}
      {sets.length === 0 ? (
        <p className="text-body text-muted-foreground">No order sets yet.</p>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order set</TableHead>
                <TableHead>Tests and panels</TableHead>
                <TableHead>Offered for</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sets.map((set) => (
                <TableRow key={set.id}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{set.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
                      {set.code}
                      <Badge variant={set.status === "active" ? "success" : "neutral"}>
                        {set.status === "active" ? <CircleCheckIcon aria-hidden /> : <CircleOffIcon aria-hidden />}
                        {set.status === "active" ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">{set.items.map((i) => i.name).join(", ")}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal">{describeTriggers(set, visitTypeName, systemName)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(set.id)} aria-label={`Edit ${set.name}`}>
                      <PencilIcon /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function OrderSetForm({
  set,
  tests,
  panels,
  visitTypes,
  codingSystems,
  onDone,
}: {
  set: LabOrderSet | null;
  tests: LabTest[];
  panels: LabPanel[];
  visitTypes: VisitType[] | null;
  codingSystems: CodingSystem[] | null;
  onDone: () => void;
}) {
  const initial = set ? formValues(set) : { prefixes: "", codeSystemKey: null, visitTypeCodes: [] as string[] };
  const [code, setCode] = React.useState(set?.code ?? "");
  const [name, setName] = React.useState(set?.name ?? "");
  const [note, setNote] = React.useState(set?.note ?? "");
  const [status, setStatus] = React.useState<"active" | "inactive">(set?.status ?? "active");
  const [chosen, setChosen] = React.useState<Choice[]>(() => (set ? set.items.map((i) => ({ kind: i.kind, id: i.id })) : []));
  const [filter, setFilter] = React.useState("");
  const [prefixes, setPrefixes] = React.useState(initial.prefixes);
  const [codeSystemKey, setCodeSystemKey] = React.useState(initial.codeSystemKey ?? "");
  const [visitTypeCodes, setVisitTypeCodes] = React.useState<string[]>(initial.visitTypeCodes);
  const { pending, run } = useServerAction({ refreshOnFailure: true });

  const needle = filter.trim().toLowerCase();
  const shows = (label: string, entryCode: string) => !needle || label.toLowerCase().includes(needle) || entryCode.includes(needle);
  const isChosen = (kind: Choice["kind"], id: string) => chosen.some((c) => c.kind === kind && c.id === id);
  const toggle = (kind: Choice["kind"], id: string, on: boolean) =>
    setChosen((list) => (on ? [...list, { kind, id }] : list.filter((c) => !(c.kind === kind && c.id === id))));
  const id = (key: string) => `order-set-${set?.id ?? "new"}-${key}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{set ? `Edit ${set.name}` : "New order set"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const items = chosen.map((c) => (c.kind === "test" ? { testId: c.id } : { panelId: c.id }));
            const triggers = triggersFrom(parsePrefixes(prefixes), codeSystemKey || null, visitTypeCodes);
            run(
              () =>
                set
                  ? updateOrderSet({ id: set.id, name, note, items, triggers, status, version: set.version })
                  : createOrderSet({ code: code.trim().toLowerCase(), name, note, items, triggers }),
              set ? "Order set saved" : "Order set created",
              onDone,
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {set ? null : (
              <div className="grid content-start gap-1">
                <Label htmlFor={id("code")}>Code</Label>
                <Input id={id("code")} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. dm-follow-up" required />
                <p className="text-meta text-muted-foreground">Lowercase letters, digits and dashes; it never changes.</p>
              </div>
            )}
            <div className="grid content-start gap-1">
              <Label htmlFor={id("name")}>Name</Label>
              <Input id={id("name")} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diabetes follow-up" required />
            </div>
            {set ? (
              <div className="grid content-start gap-1">
                <Label htmlFor={id("status")}>Status</Label>
                <NativeSelect id={id("status")} value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive (not offered)</option>
                </NativeSelect>
              </div>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label htmlFor={id("note")}>Note (optional)</Label>
            <Textarea id={id("note")} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What the set is for, shown with it" />
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-table font-medium">Tests and panels ({chosen.length} chosen)</legend>
            <Input aria-label="Filter tests and panels" placeholder="Filter tests and panels" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="grid max-h-56 gap-x-4 gap-y-1 overflow-auto rounded-md border p-2 sm:grid-cols-2">
              {panels
                .filter((p) => shows(p.name, p.code))
                .map((p) => (
                  <label key={`panel-${p.id}`} className="flex items-center gap-2 text-table">
                    <Checkbox checked={isChosen("panel", p.id)} onCheckedChange={(c) => toggle("panel", p.id, c === true)} />
                    <span className="font-medium">{p.name}</span> <span className="text-meta text-muted-foreground">panel · {p.testIds.length}</span>
                  </label>
                ))}
              {tests
                .filter((t) => shows(t.name, t.code))
                .map((t) => (
                  <label key={`test-${t.id}`} className="flex items-center gap-2 text-table">
                    <Checkbox checked={isChosen("test", t.id)} onCheckedChange={(c) => toggle("test", t.id, c === true)} />
                    <span>{t.name}</span>
                  </label>
                ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-table font-medium">Offer it for (optional)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1">
                <Label htmlFor={id("prefixes")}>Diagnosis codes starting with</Label>
                <Input id={id("prefixes")} value={prefixes} onChange={(e) => setPrefixes(e.target.value)} placeholder="e.g. E11, E10" />
                <p className="text-meta text-muted-foreground">Separate codes with commas. A code matches when it starts with one of these.</p>
              </div>
              <div className="grid content-start gap-1">
                <Label htmlFor={id("system")}>In coding system</Label>
                <NativeSelect id={id("system")} value={codeSystemKey} onChange={(e) => setCodeSystemKey(e.target.value)} emptyText="No coding systems set up">
                  <option value="">Any coding system</option>
                  {(codingSystems ?? []).map((c) => (
                    <option key={c.id} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {visitTypes ? (
              visitTypes.length ? (
                <div className="grid gap-1">
                  <span className="text-table font-medium">Visit types</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {visitTypes.map((v) => (
                      <label key={v.id} className="flex items-center gap-2 text-table">
                        <Checkbox
                          checked={visitTypeCodes.includes(v.code)}
                          onCheckedChange={(c) => setVisitTypeCodes((list) => (c === true ? [...list, v.code] : list.filter((x) => x !== v.code)))}
                        />
                        {v.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null
            ) : (
              <p className="text-meta text-muted-foreground">Visit types are not shown: reading them needs access to appointments.</p>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending || chosen.length === 0}>
              {set ? "Save" : "Create"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
