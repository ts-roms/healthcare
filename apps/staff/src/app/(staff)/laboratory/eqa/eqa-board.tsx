"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2Icon, CircleDashedIcon, PlusIcon, XCircleIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import type { EqaEvaluation, LabEqaScheme, LabEqaSurvey, LabTest } from "@/lib/api/types";
import { createEqaScheme, createEqaSurvey, recordEqaEvaluation, reportEqaResult } from "../quality-management-actions";
import { useRun } from "../quality-ui";

function EvaluationBadge({ evaluation }: { evaluation: EqaEvaluation | null }) {
  if (evaluation === "acceptable")
    return (
      <Badge variant="success">
        <CheckCircle2Icon aria-hidden /> Acceptable
      </Badge>
    );
  if (evaluation === "unacceptable")
    return (
      <Badge variant="danger">
        <XCircleIcon aria-hidden /> Unacceptable
      </Badge>
    );
  return (
    <Badge variant="neutral">
      <CircleDashedIcon aria-hidden /> {evaluation === "not_graded" ? "Not graded" : "Awaiting evaluation"}
    </Badge>
  );
}

export function EqaBoard({
  schemes,
  surveys,
  tests,
  canEnter,
  canManage,
}: {
  schemes: LabEqaScheme[];
  surveys: LabEqaSurvey[];
  tests: LabTest[];
  canEnter: boolean;
  canManage: boolean;
}) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        {surveys.length === 0 ? <p className="text-body text-muted-foreground">No EQA rounds recorded yet.</p> : null}
        {surveys.map((s) => (
          <Card key={s.id}>
            <CardHeader>
              <CardTitle>
                {s.scheme.name} · round {s.roundCode}
              </CardTitle>
              <p className="text-meta text-muted-foreground">
                {s.scheme.provider} · received {clinicalDate(s.receivedOn)}
                {s.dueOn ? ` · due ${clinicalDate(s.dueOn)}` : ""} · {s.status}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {s.results.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sample</TableHead>
                      <TableHead>Test</TableHead>
                      <TableHead>Reported</TableHead>
                      <TableHead>Evaluation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.results.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.sampleCode}</TableCell>
                        <TableCell>{r.testName}</TableCell>
                        <TableCell className="tabular">
                          {r.reportedValue}
                          <span className="block text-meta text-muted-foreground">{r.reportedByName}</span>
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-col items-start gap-1">
                            <EvaluationBadge evaluation={r.evaluation} />
                            {r.evaluation ? (
                              <span className="text-meta text-muted-foreground">
                                {[r.targetValue ? `target ${r.targetValue}` : null, r.providerScore ? `score ${r.providerScore}` : null, r.evaluationNote]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            ) : canEnter ? (
                              <EvaluationForm resultId={r.id} />
                            ) : null}
                            {r.nonconformance ? (
                              <Link href={`/laboratory/nonconformances/${r.nonconformance.id}`} className="text-meta text-primary hover:underline">
                                {r.nonconformance.number}
                              </Link>
                            ) : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-table text-muted-foreground">No results reported yet.</p>
              )}
              {canEnter ? <ResultForm surveyId={s.id} tests={tests} /> : null}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-col gap-4 self-start">
        {canEnter ? <SurveyForm schemes={schemes.filter((s) => s.status === "active")} /> : null}
        <Card>
          <CardHeader>
            <CardTitle>Schemes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            {schemes.length === 0 ? <p className="text-muted-foreground">No schemes yet.</p> : null}
            {schemes.map((s) => (
              <p key={s.id}>
                {s.name} <span className="text-meta text-muted-foreground">· {s.provider}</span>
              </p>
            ))}
            {canManage ? <SchemeForm /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SurveyForm({ schemes }: { schemes: LabEqaScheme[] }) {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ schemeId: "", roundCode: "", receivedOn: "", dueOn: "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a round received</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => createEqaSurvey({ ...f, dueOn: f.dueOn || undefined }),
              "Round recorded",
              () => setF({ schemeId: f.schemeId, roundCode: "", receivedOn: "", dueOn: "" }),
            );
          }}
        >
          <NativeSelect placeholder="Scheme…" aria-label="Scheme" value={f.schemeId} onChange={(e) => setF({ ...f, schemeId: e.target.value })}>
            {schemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.provider}
              </option>
            ))}
          </NativeSelect>
          <Input aria-label="Round" placeholder="Round, e.g. 2026-3" value={f.roundCode} onChange={(e) => setF({ ...f, roundCode: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="eqa-received">Received</Label>
              <DateInput id="eqa-received" value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="eqa-due">Due (optional)</Label>
              <DateInput id="eqa-due" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} />
            </div>
          </div>
          <Button type="submit" size="sm" className="self-start" disabled={pending || !f.schemeId || !f.receivedOn}>
            <PlusIcon /> Record round
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ResultForm({ surveyId, tests }: { surveyId: string; tests: LabTest[] }) {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ testId: "", sampleCode: "", reportedValue: "" });
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => reportEqaResult({ surveyId, ...f }),
          "Result recorded",
          () => setF({ ...f, sampleCode: "", reportedValue: "" }),
        );
      }}
    >
      <Input aria-label="Sample code" placeholder="Sample" className="w-24" value={f.sampleCode} onChange={(e) => setF({ ...f, sampleCode: e.target.value })} />
      <NativeSelect placeholder="Test…" aria-label="Test" value={f.testId} onChange={(e) => setF({ ...f, testId: e.target.value })}>
        {tests.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label="Reported value"
        placeholder="Value reported"
        className="w-36"
        value={f.reportedValue}
        onChange={(e) => setF({ ...f, reportedValue: e.target.value })}
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !f.testId || !f.sampleCode.trim() || !f.reportedValue.trim()}>
        Add result
      </Button>
    </form>
  );
}

function EvaluationForm({ resultId }: { resultId: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ evaluation: "acceptable" as EqaEvaluation, targetValue: "", providerScore: "", note: "" });
  if (!open)
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Record evaluation…
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => recordEqaEvaluation({ resultId, ...f }), f.evaluation === "unacceptable" ? "Unacceptable — nonconformance opened" : "Evaluation recorded");
      }}
    >
      <NativeSelect aria-label="Provider's evaluation" value={f.evaluation} onChange={(e) => setF({ ...f, evaluation: e.target.value as EqaEvaluation })}>
        <option value="acceptable">Acceptable</option>
        <option value="unacceptable">Unacceptable</option>
        <option value="not_graded">Not graded</option>
      </NativeSelect>
      <div className="flex gap-1">
        <Input
          aria-label="Target value"
          placeholder="Target"
          className="h-8 w-24"
          value={f.targetValue}
          onChange={(e) => setF({ ...f, targetValue: e.target.value })}
        />
        <Input
          aria-label="Provider score"
          placeholder="Score"
          className="h-8 w-20"
          value={f.providerScore}
          onChange={(e) => setF({ ...f, providerScore: e.target.value })}
        />
      </div>
      <Input aria-label="Note" placeholder="Note (optional)" className="h-8" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <Button type="submit" size="xs" className="self-start" disabled={pending}>
        Save evaluation
      </Button>
    </form>
  );
}

function SchemeForm() {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ code: "", provider: "", name: "" });
  return (
    <form
      className="flex flex-col gap-1 border-t pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createEqaScheme(f),
          "Scheme added",
          () => setF({ code: "", provider: "", name: "" }),
        );
      }}
    >
      <Input aria-label="Code" placeholder="Code, e.g. chem-eqa" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
      <Input aria-label="Provider" placeholder="Provider (as it names itself)" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} />
      <Input aria-label="Scheme name" placeholder="Programme name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Button type="submit" size="sm" variant="outline" className="self-start" disabled={pending}>
        <PlusIcon /> Add scheme
      </Button>
    </form>
  );
}
