"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, ShieldAlertIcon } from "lucide-react";
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
import type { LabCatalogEntry, LabPanel, LabPolicy, LabReferenceRange, LabResultType, LabSpecimenType, LabTest, QcRejectRule } from "@/lib/api/types";
import { addReferenceRange, createCatalogEntry, createLabPanel, createLabTest, setLabPolicy, setLabTestStatus } from "../actions";

const QC_RULES: Array<[QcRejectRule, string]> = [
  ["1_3s", "1-3s"],
  ["2_2s", "2-2s"],
  ["R_4s", "R-4s"],
  ["4_1s", "4-1s"],
  ["10_x", "10-x"],
];

type Run = (call: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) => void;

function useRun(): { pending: boolean; run: Run } {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run: Run = (call, success, after) =>
    start(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong.");
    });
  return { pending, run };
}

/** "3.9–5.5 (crit ≤2.2 / ≥22.2)" · "male, 18 y+" */
export function describeRange(r: LabReferenceRange): string {
  const limits =
    r.low !== null || r.high !== null
      ? r.low !== null && r.high !== null
        ? `${r.low}–${r.high}`
        : r.high !== null
          ? `≤ ${r.high}`
          : `≥ ${r.low}`
      : (r.textRange ?? "");
  const critical = [r.criticalLow !== null ? `≤${r.criticalLow}` : null, r.criticalHigh !== null ? `≥${r.criticalHigh}` : null].filter(Boolean).join(" / ");
  const who = [r.sex ?? "any sex", ageBand(r)].filter(Boolean).join(", ");
  return `${limits}${critical ? ` (critical ${critical})` : ""} · ${who}`;
}

function ageBand(r: Pick<LabReferenceRange, "ageMinDays" | "ageMaxDays">): string {
  const fmt = (days: number) => (days % 365 === 0 && days >= 365 ? `${days / 365} y` : `${days} d`);
  if (r.ageMinDays === 0 && r.ageMaxDays === null) return "all ages";
  if (r.ageMaxDays === null) return `${fmt(r.ageMinDays)}+`;
  return `${fmt(r.ageMinDays)} to under ${fmt(r.ageMaxDays)}`;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function LabCatalog({
  tests,
  departments,
  specimenTypes,
  panels,
  policy,
  facilityName,
  canManage,
}: {
  tests: LabTest[];
  departments: LabCatalogEntry[];
  specimenTypes: LabSpecimenType[];
  panels: LabPanel[];
  policy: LabPolicy | null;
  facilityName: string | null;
  canManage: boolean;
}) {
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const specimenName = new Map(specimenTypes.map((s) => [s.id, s.name]));
  const testName = new Map(tests.map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Tests</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {tests.length === 0 ? <p className="text-table text-muted-foreground">No tests yet.</p> : null}
          {tests.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Department · specimen</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Current reference ranges</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.map((t) => (
                  <TestRow
                    key={t.id}
                    test={t}
                    department={departmentName.get(t.departmentId)}
                    specimen={specimenName.get(t.specimenTypeId)}
                    canManage={canManage}
                  />
                ))}
              </TableBody>
            </Table>
          ) : null}
          {canManage ? <NewTestForm departments={departments} specimenTypes={specimenTypes} /> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <EntryList title="Departments" kind="departments" entries={departments} canManage={canManage} />
        <EntryList title="Specimen types" kind="specimen-types" entries={specimenTypes} canManage={canManage} />
        <Card>
          <CardHeader>
            <CardTitle>Panels</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {panels.map((p) => (
              <p key={p.id} className="text-table">
                <span className="font-medium">{p.name}</span> <span className="font-mono text-meta text-muted-foreground">{p.code}</span>
                <span className="block text-meta text-muted-foreground">{p.testIds.map((id) => testName.get(id) ?? "?").join(", ")}</span>
              </p>
            ))}
            {panels.length === 0 ? <p className="text-table text-muted-foreground">No panels.</p> : null}
            {canManage && tests.length ? <NewPanelForm tests={tests.filter((t) => t.status === "active")} /> : null}
          </CardContent>
        </Card>
      </div>

      {policy && facilityName ? <PolicyCard policy={policy} facilityName={facilityName} canManage={canManage} /> : null}
    </div>
  );
}

function TestRow({ test, department, specimen, canManage }: { test: LabTest; department?: string; specimen?: string; canManage: boolean }) {
  const { pending, run } = useRun();
  const [addingRange, setAddingRange] = React.useState(false);
  return (
    <>
      <TableRow className={test.status === "inactive" ? "opacity-60" : undefined}>
        <TableCell>
          <span className="font-medium">{test.name}</span> <span className="font-mono text-meta text-muted-foreground">{test.code}</span>
          <span className="block text-meta text-muted-foreground">
            {[
              test.loincCode ? `LOINC ${test.loincCode}` : null,
              test.requiresFasting ? "fasting" : null,
              test.patientReleasable ? null : "not shown to patients",
              test.turnaroundMinutes ? `TAT ${test.turnaroundMinutes} min` : null,
              test.status === "inactive" ? "inactive" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </TableCell>
        <TableCell className="text-table">
          {department ?? "—"} · {specimen ?? "—"}
        </TableCell>
        <TableCell className="text-table">
          {test.resultType === "numeric" ? `Numeric${test.unit ? ` (${test.unit})` : ""}` : test.resultType === "coded" ? test.codedValues.join(" / ") : "Text"}
        </TableCell>
        <TableCell className="text-table">
          {test.referenceRanges.length ? (
            <ul>
              {test.referenceRanges.map((r) => (
                <li key={r.id}>{describeRange(r)}</li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">None — results are not flagged</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {canManage ? (
            <span className="flex justify-end gap-1">
              {test.status === "active" ? (
                <Button size="xs" variant="outline" onClick={() => setAddingRange((v) => !v)}>
                  <PlusIcon /> Range
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setLabTestStatus({ testId: test.id, status: test.status === "active" ? "inactive" : "active", version: test.version }),
                    test.status === "active" ? `${test.name} can no longer be ordered` : `${test.name} can be ordered again`,
                  )
                }
              >
                {test.status === "active" ? "Deactivate" : "Activate"}
              </Button>
            </span>
          ) : null}
        </TableCell>
      </TableRow>
      {addingRange ? (
        <TableRow>
          <TableCell colSpan={5}>
            <RangeForm test={test} onDone={() => setAddingRange(false)} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function RangeForm({ test, onDone }: { test: LabTest; onDone: () => void }) {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ sex: "", ageMinYears: "", ageMaxYears: "", low: "", high: "", criticalLow: "", criticalHigh: "", textRange: "" });
  const field = (key: keyof typeof f, label: string, width = "w-24") => (
    <div className="grid gap-1">
      <Label htmlFor={`${test.id}-${key}`}>{label}</Label>
      <Input id={`${test.id}-${key}`} className={width} inputMode="decimal" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </div>
  );
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const years = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 365));
        run(
          () =>
            addReferenceRange({
              testId: test.id,
              sex: f.sex === "male" || f.sex === "female" ? f.sex : null,
              ageMinDays: years(f.ageMinYears) ?? 0,
              ageMaxDays: years(f.ageMaxYears),
              low: num(f.low),
              high: num(f.high),
              criticalLow: num(f.criticalLow),
              criticalHigh: num(f.criticalHigh),
              textRange: f.textRange.trim() || null,
            }),
          `Reference range added to ${test.name} (takes effect now)`,
          onDone,
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`${test.id}-sex`}>Sex</Label>
        <NativeSelect id={`${test.id}-sex`} value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}>
          <option value="">Any</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </NativeSelect>
      </div>
      {field("ageMinYears", "From age (y)", "w-20")}
      {field("ageMaxYears", "Under age (y)", "w-20")}
      {test.resultType === "numeric" ? (
        <>
          {field("low", "Low")}
          {field("high", "High")}
          {field("criticalLow", "Critical ≤")}
          {field("criticalHigh", "Critical ≥")}
        </>
      ) : (
        field("textRange", "Expected (text)", "w-40")
      )}
      <Button type="submit" size="sm" disabled={pending}>
        Add range
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <p className="w-full text-meta text-muted-foreground">
        A range for the same sex and ages replaces the current one from now on. Use the laboratory&apos;s validated ranges for its method and population.
      </p>
    </form>
  );
}

function NewTestForm({ departments, specimenTypes }: { departments: LabCatalogEntry[]; specimenTypes: LabSpecimenType[] }) {
  const { pending, run } = useRun();
  const blank = {
    code: "",
    name: "",
    departmentId: "",
    specimenTypeId: "",
    resultType: "numeric" as LabResultType,
    unit: "",
    decimalPlaces: "1",
    loincCode: "",
    codedValues: "",
    abnormalCodedValues: "",
    turnaroundMinutes: "",
    requiresFasting: false,
    patientReleasable: true,
  };
  const [f, setF] = React.useState(blank);
  const [open, setOpen] = React.useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)} disabled={!departments.length || !specimenTypes.length}>
        <PlusIcon /> New test{!departments.length || !specimenTypes.length ? " (add a department and specimen type first)" : ""}
      </Button>
    );
  }
  const list = (v: string) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <form
      className="grid gap-2 rounded-md border p-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            createLabTest({
              code: f.code,
              name: f.name,
              departmentId: f.departmentId,
              specimenTypeId: f.specimenTypeId,
              resultType: f.resultType,
              unit: f.unit,
              decimalPlaces: f.resultType === "numeric" && f.decimalPlaces !== "" ? Number(f.decimalPlaces) : undefined,
              loincCode: f.loincCode,
              codedValues: list(f.codedValues),
              abnormalCodedValues: list(f.abnormalCodedValues),
              turnaroundMinutes: f.turnaroundMinutes ? Number(f.turnaroundMinutes) : undefined,
              requiresFasting: f.requiresFasting,
              patientReleasable: f.patientReleasable,
            }),
          `Test ${f.name} added`,
          () => {
            setF(blank);
            setOpen(false);
          },
        );
      }}
    >
      <TextField label="Code *" value={f.code} onChange={(v) => setF({ ...f, code: v })} placeholder="fbs" />
      <TextField label="Name *" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Fasting blood sugar" className="sm:col-span-3" />
      <div className="grid gap-1">
        <Label htmlFor="test-department">Department *</Label>
        <NativeSelect id="test-department" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
          <option value="">Choose…</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="test-specimen">Specimen *</Label>
        <NativeSelect id="test-specimen" value={f.specimenTypeId} onChange={(e) => setF({ ...f, specimenTypeId: e.target.value })}>
          <option value="">Choose…</option>
          {specimenTypes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="test-type">Result type</Label>
        <NativeSelect id="test-type" value={f.resultType} onChange={(e) => setF({ ...f, resultType: e.target.value as LabResultType })}>
          <option value="numeric">Numeric</option>
          <option value="coded">Coded (choose from a list)</option>
          <option value="text">Text</option>
        </NativeSelect>
      </div>
      <TextField label="LOINC (optional)" value={f.loincCode} onChange={(v) => setF({ ...f, loincCode: v })} placeholder="1558-6" />
      {f.resultType === "numeric" ? (
        <>
          <TextField label="Unit" value={f.unit} onChange={(v) => setF({ ...f, unit: v })} placeholder="mmol/L" />
          <TextField label="Decimal places" value={f.decimalPlaces} onChange={(v) => setF({ ...f, decimalPlaces: v })} />
        </>
      ) : null}
      {f.resultType === "coded" ? (
        <>
          <TextField
            label="Allowed values (comma-separated) *"
            value={f.codedValues}
            onChange={(v) => setF({ ...f, codedValues: v })}
            placeholder="Reactive, Nonreactive"
          />
          <TextField label="Abnormal values" value={f.abnormalCodedValues} onChange={(v) => setF({ ...f, abnormalCodedValues: v })} placeholder="Reactive" />
        </>
      ) : null}
      <TextField label="Turnaround (minutes)" value={f.turnaroundMinutes} onChange={(v) => setF({ ...f, turnaroundMinutes: v })} />
      <label className="flex items-center gap-2 text-table">
        <Checkbox checked={f.requiresFasting} onCheckedChange={(c) => setF({ ...f, requiresFasting: c === true })} /> Requires fasting
      </label>
      <label className="flex items-center gap-2 text-table sm:col-span-2">
        <Checkbox checked={f.patientReleasable} onCheckedChange={(c) => setF({ ...f, patientReleasable: c === true })} /> Released results may be shown to the
        patient
      </label>
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" size="sm" disabled={pending || !f.code || !f.name || !f.departmentId || !f.specimenTypeId}>
          Add test
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div className={`grid gap-1 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function EntryList({
  title,
  kind,
  entries,
  canManage,
}: {
  title: string;
  kind: "departments" | "specimen-types";
  entries: Array<LabCatalogEntry & { container?: string | null }>;
  canManage: boolean;
}) {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ code: "", name: "", container: "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {entries.map((e) => (
          <p key={e.id} className="text-table">
            <span className="font-medium">{e.name}</span> <span className="font-mono text-meta text-muted-foreground">{e.code}</span>
            {e.container ? <span className="block text-meta text-muted-foreground">{e.container}</span> : null}
          </p>
        ))}
        {entries.length === 0 ? <p className="text-table text-muted-foreground">None yet.</p> : null}
        {canManage ? (
          <form
            className="flex flex-wrap items-end gap-1.5 border-t pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => createCatalogEntry({ kind, ...f }),
                `${f.name} added`,
                () => setF({ code: "", name: "", container: "" }),
              );
            }}
          >
            <Input aria-label={`${title}: code`} placeholder="code" className="w-24" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
            <Input aria-label={`${title}: name`} placeholder="Name" className="w-40" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            {kind === "specimen-types" ? (
              <Input
                aria-label="Container"
                placeholder="Container"
                className="w-36"
                value={f.container}
                onChange={(e) => setF({ ...f, container: e.target.value })}
              />
            ) : null}
            <Button type="submit" size="sm" variant="outline" disabled={pending || !f.code || !f.name}>
              <PlusIcon /> Add
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NewPanelForm({ tests }: { tests: LabTest[] }) {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ code: "", name: "", testIds: [] as string[] });
  return (
    <form
      className="flex flex-col gap-1.5 border-t pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createLabPanel(f),
          `Panel ${f.name} added`,
          () => setF({ code: "", name: "", testIds: [] }),
        );
      }}
    >
      <div className="flex gap-1.5">
        <Input aria-label="Panel code" placeholder="code" className="w-24" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        <Input aria-label="Panel name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div className="flex max-h-40 flex-col gap-1 overflow-auto">
        {tests.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-table">
            <Checkbox
              checked={f.testIds.includes(t.id)}
              onCheckedChange={(c) => setF({ ...f, testIds: c ? [...f.testIds, t.id] : f.testIds.filter((id) => id !== t.id) })}
            />
            {t.name}
          </label>
        ))}
      </div>
      <Button type="submit" size="sm" variant="outline" className="self-start" disabled={pending || !f.code || !f.name || f.testIds.length === 0}>
        <PlusIcon /> Add panel
      </Button>
    </form>
  );
}

function PolicyCard({ policy, facilityName, canManage }: { policy: LabPolicy; facilityName: string; canManage: boolean }) {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ ...policy, qcValidHours: String(policy.qcValidHours), reason: "" });
  const changed =
    f.allowSelfVerification !== policy.allowSelfVerification ||
    f.allowSelfApproval !== policy.allowSelfApproval ||
    f.releaseOnApproval !== policy.releaseOnApproval ||
    f.qcRequired !== policy.qcRequired ||
    f.qcValidHours !== String(policy.qcValidHours) ||
    f.qcAfterReagentChange !== policy.qcAfterReagentChange ||
    f.competencyRequired !== policy.competencyRequired ||
    [...f.qcRejectRules].sort().join() !== [...policy.qcRejectRules].sort().join();
  const toggleRule = (rule: QcRejectRule, on: boolean) =>
    setF((s) => ({ ...s, qcRejectRules: on ? [...new Set([...s.qcRejectRules, rule])] : s.qcRejectRules.filter((r) => r !== rule) }));
  const toggle = (
    key: "allowSelfVerification" | "allowSelfApproval" | "releaseOnApproval" | "qcRequired" | "qcAfterReagentChange" | "competencyRequired",
    label: string,
  ) => (
    <label className="flex items-center gap-2 text-table">
      <Checkbox disabled={!canManage} checked={f[key]} onCheckedChange={(c) => setF({ ...f, [key]: c === true })} /> {label}
    </label>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Laboratory policy · {facilityName}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                setLabPolicy({
                  allowSelfVerification: f.allowSelfVerification,
                  allowSelfApproval: f.allowSelfApproval,
                  releaseOnApproval: f.releaseOnApproval,
                  qcRejectRules: f.qcRejectRules,
                  qcValidHours: Number(f.qcValidHours),
                  qcRequired: f.qcRequired,
                  qcAfterReagentChange: f.qcAfterReagentChange,
                  competencyRequired: f.competencyRequired,
                  reason: f.reason,
                }),
              "Laboratory policy updated",
              () => setF((s) => ({ ...s, reason: "" })),
            );
          }}
        >
          <p className="flex items-start gap-2 text-meta text-muted-foreground">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            By default the person who enters a result cannot also verify or approve it. Allow exceptions only where staffing requires it; each self sign-off is
            recorded on the result.
          </p>
          {toggle("allowSelfVerification", "Allow the person who entered a result to verify it")}
          {toggle("allowSelfApproval", "Allow the person who entered a result to approve it")}
          {toggle("releaseOnApproval", "Release results automatically when approved")}
          {policy.allowSelfVerification || policy.allowSelfApproval ? <Badge variant="warning">Separation of duties relaxed at this facility</Badge> : null}
          <fieldset className="mt-2 flex flex-col gap-2 border-t pt-2">
            <legend className="text-table font-medium">Quality control</legend>
            <p className="text-meta text-muted-foreground">
              Rules that reject a QC run (a 1-2s result is always a warning). Choose them with your laboratory&apos;s QC plan; they are not prescribed here.
            </p>
            <div className="flex flex-wrap gap-3">
              {QC_RULES.map(([rule, label]) => (
                <label key={rule} className="flex items-center gap-1.5 text-table">
                  <Checkbox disabled={!canManage} checked={f.qcRejectRules.includes(rule)} onCheckedChange={(c) => toggleRule(rule, c === true)} /> {label}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-table">
              <Label htmlFor="qc-window">A QC run covers patient results for</Label>
              <Input
                id="qc-window"
                className="w-20"
                type="number"
                min={1}
                max={168}
                disabled={!canManage}
                value={f.qcValidHours}
                onChange={(e) => setF({ ...f, qcValidHours: e.target.value })}
              />
              hours
            </div>
            {toggle("qcRequired", "Refuse results on an instrument without QC in that window, or while a control level is rejected")}
            {toggle("qcAfterReagentChange", "Start the QC window again when a new reagent lot is loaded for a test")}
            {toggle("competencyRequired", "Refuse results from staff without a current competent assessment for the test or its section")}
          </fieldset>
          {canManage && changed ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-64 flex-1 gap-1">
                <Label htmlFor="policy-reason">Reason for the change *</Label>
                <Input id="policy-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} />
              </div>
              <Button type="submit" size="sm" disabled={pending || f.reason.trim().length < 3}>
                Save policy
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
