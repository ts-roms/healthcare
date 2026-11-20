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
import type { MedicineSetting } from "@/lib/api/types";
import { describeMedicineSetting, parseMaximum } from "@/lib/prescribing-check";
import { useServerAction } from "@/lib/use-server-action";
import { createMedicineSetting, updateMedicineSetting } from "./actions";

export function MedicineSettingsManager({ medicines }: { medicines: MedicineSetting[] }) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const current = editing && editing !== "new" ? (medicines.find((m) => m.id === editing) ?? null) : null;
  return (
    <div className="grid gap-4">
      {editing ? (
        <MedicineForm key={editing} setting={current} onDone={() => setEditing(null)} />
      ) : (
        <Button size="sm" className="justify-self-start" onClick={() => setEditing("new")}>
          <PlusIcon /> Add a medicine
        </Button>
      )}
      {medicines.length === 0 ? (
        <p className="text-body text-muted-foreground">No medicine settings yet.</p>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medicine</TableHead>
                <TableHead>Settings</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {medicines.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{m.name}</div>
                    <Badge variant={m.status === "active" ? "success" : "neutral"}>
                      {m.status === "active" ? <CircleCheckIcon aria-hidden /> : <CircleOffIcon aria-hidden />}
                      {m.status === "active" ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-96 whitespace-normal">
                    <div>{describeMedicineSetting(m)}</div>
                    {m.note ? <div className="text-meta text-muted-foreground">{m.note}</div> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(m.id)} aria-label={`Edit ${m.name}`}>
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

function MedicineForm({ setting, onDone }: { setting: MedicineSetting | null; onDone: () => void }) {
  const [name, setName] = React.useState(setting?.name ?? "");
  const [className, setClassName] = React.useState(setting?.className ?? "");
  const [maximum, setMaximum] = React.useState(setting?.maxDailyDose === null || setting?.maxDailyDose === undefined ? "" : String(setting.maxDailyDose));
  const [doseUnit, setDoseUnit] = React.useState(setting?.doseUnit ?? "mg");
  const [checkRenal, setCheckRenal] = React.useState(setting?.checkRenal ?? false);
  const [checkPregnancy, setCheckPregnancy] = React.useState(setting?.checkPregnancy ?? false);
  const [note, setNote] = React.useState(setting?.note ?? "");
  const [status, setStatus] = React.useState<"active" | "inactive">(setting?.status ?? "active");
  const [problem, setProblem] = React.useState<string | null>(null);
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  const id = (key: string) => `medicine-${setting?.id ?? "new"}-${key}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{setting ? `Edit ${setting.name}` : "Add a medicine"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const maxDailyDose = parseMaximum(maximum);
            if (Number.isNaN(maxDailyDose)) {
              setProblem("The maximum daily dose must be a number above 0, or blank.");
              return;
            }
            setProblem(null);
            const values = { name, className, maxDailyDose, doseUnit: maxDailyDose === null ? "" : doseUnit, checkRenal, checkPregnancy, note };
            run(
              () => (setting ? updateMedicineSetting({ ...values, id: setting.id, status, version: setting.version }) : createMedicineSetting(values)),
              setting ? "Medicine setting saved" : "Medicine setting added",
              onDone,
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid content-start gap-1">
              <Label htmlFor={id("name")}>Medicine (generic name)</Label>
              <Input id={id("name")} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. metformin" required />
              <p className="text-meta text-muted-foreground">Also matches names that hold these words, such as “Metformin HCl 500 mg”.</p>
            </div>
            <div className="grid content-start gap-1">
              <Label htmlFor={id("class")}>Class (optional)</Label>
              <Input id={id("class")} value={className} onChange={(e) => setClassName(e.target.value)} placeholder="e.g. NSAID" />
              <p className="text-meta text-muted-foreground">Two current medicines of one class are shown as a possible duplicate.</p>
            </div>
            <div className="grid content-start gap-1">
              <Label htmlFor={id("max")}>Maximum daily dose (optional)</Label>
              <div className="flex gap-2">
                <Input id={id("max")} inputMode="decimal" value={maximum} onChange={(e) => setMaximum(e.target.value)} placeholder="e.g. 3000" />
                <Input aria-label="Unit of the maximum" className="w-24" value={doseUnit} onChange={(e) => setDoseUnit(e.target.value)} placeholder="mg" />
              </div>
              <p className="text-meta text-muted-foreground">Compared only with doses worked out in the same unit.</p>
            </div>
            {setting ? (
              <div className="grid content-start gap-1">
                <Label htmlFor={id("status")}>Status</Label>
                <NativeSelect id={id("status")} value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive (not used)</option>
                </NativeSelect>
              </div>
            ) : null}
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-table font-medium">Before prescribing, ask the doctor to check</legend>
            <label className="flex items-center gap-2 text-table">
              <Checkbox checked={checkRenal} onCheckedChange={(c) => setCheckRenal(c === true)} />
              Kidney function
            </label>
            <label className="flex items-center gap-2 text-table">
              <Checkbox checked={checkPregnancy} onCheckedChange={(c) => setCheckPregnancy(c === true)} />
              Whether the patient may be pregnant
            </label>
          </fieldset>
          <div className="grid gap-1">
            <Label htmlFor={id("note")}>Note shown with the suggestions (optional)</Label>
            <Textarea
              id={id("note")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="e.g. Look at the last eGFR"
            />
          </div>
          {problem ? (
            <p role="alert" className="text-table text-danger-foreground">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending || name.trim().length < 2}>
              {setting ? "Save" : "Add"}
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
