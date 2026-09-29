"use client";

import * as React from "react";
import { CheckCircle2Icon, ClockAlertIcon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import type { CompetencyMethod, LabCatalogEntry, LabCompetencyOverview, LabTest } from "@/lib/api/types";
import { recordCompetency } from "../quality-management-actions";
import { useRun } from "../quality-ui";

type Area = LabCompetencyOverview["staff"][number]["areas"][number];

const METHOD_LABEL: Record<CompetencyMethod, string> = {
  direct_observation: "Direct observation",
  blind_sample: "Blind sample",
  record_review: "Record review",
  written_assessment: "Written assessment",
  other: "Other",
};

/** State as colour + icon + text. */
function StateBadge({ state }: { state: Area["state"] }) {
  if (state === "competent")
    return (
      <Badge variant="success">
        <CheckCircle2Icon aria-hidden /> Competent
      </Badge>
    );
  if (state === "due")
    return (
      <Badge variant="warning">
        <ClockAlertIcon aria-hidden /> Reassessment due
      </Badge>
    );
  return (
    <Badge variant="danger">
      <XCircleIcon aria-hidden /> Not yet competent
    </Badge>
  );
}

export function CompetencyBoard({
  overview,
  tests,
  departments,
  currentUserId,
  canAssess,
}: {
  overview: LabCompetencyOverview;
  tests: LabTest[];
  departments: LabCatalogEntry[];
  currentUserId: string;
  canAssess: boolean;
}) {
  const testName = new Map(tests.map((t) => [t.id, t.name]));
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const areaName = (a: Area) => (a.testId ? (testName.get(a.testId) ?? "Test") : `${departmentName.get(a.departmentId ?? "") ?? "Section"} (whole section)`);
  const assessable = overview.staff.filter((s) => s.userId !== currentUserId);

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <p className="flex items-center gap-2 text-table text-muted-foreground">
          <ShieldCheckIcon aria-hidden className="size-4" />
          {overview.competencyRequired
            ? "Result entry at this facility requires a current competent assessment for the test or its section."
            : "Result entry does not check competency at this facility (see the laboratory policy in the catalog)."}
        </p>
        {overview.staff.length === 0 ? <p className="text-body text-muted-foreground">No staff at this facility enter results.</p> : null}
        {overview.staff.map((person) => (
          <Card key={person.userId}>
            <CardHeader>
              <CardTitle>{person.displayName}</CardTitle>
            </CardHeader>
            <CardContent>
              {person.areas.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Area</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Assessed</TableHead>
                      <TableHead>Next due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {person.areas.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{areaName(a)}</TableCell>
                        <TableCell>
                          <StateBadge state={a.state} />
                          {a.notes ? <span className="mt-1 block text-meta text-muted-foreground">{a.notes}</span> : null}
                        </TableCell>
                        <TableCell>
                          {clinicalDate(a.assessedOn)}
                          <span className="block text-meta text-muted-foreground">
                            {METHOD_LABEL[a.method]}
                            {a.assessedByName ? ` · ${a.assessedByName}` : ""}
                          </span>
                        </TableCell>
                        <TableCell>{a.nextDueOn ? clinicalDate(a.nextDueOn) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-table text-muted-foreground">No assessments recorded.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {canAssess ? <AssessmentForm staff={assessable} tests={tests} departments={departments} /> : null}
    </div>
  );
}

function AssessmentForm({ staff, tests, departments }: { staff: LabCompetencyOverview["staff"]; tests: LabTest[]; departments: LabCatalogEntry[] }) {
  const { pending, run } = useRun();
  const empty = {
    userId: "",
    area: "",
    method: "direct_observation" as CompetencyMethod,
    outcome: "competent" as const,
    assessedOn: "",
    nextDueOn: "",
    notes: "",
  };
  const [f, setF] = React.useState<Omit<typeof empty, "outcome"> & { outcome: "competent" | "not_yet_competent" }>(empty);
  const [kind, id] = f.area.split(":");
  const notesMissing = f.outcome === "not_yet_competent" && !f.notes.trim();
  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>Record an assessment</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-meta text-muted-foreground">You cannot assess yourself. Assessments are kept as history; the latest counts.</p>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                recordCompetency({
                  userId: f.userId,
                  testId: kind === "test" ? id : undefined,
                  departmentId: kind === "department" ? id : undefined,
                  method: f.method,
                  outcome: f.outcome,
                  assessedOn: f.assessedOn,
                  nextDueOn: f.nextDueOn || undefined,
                  notes: f.notes.trim() || undefined,
                }),
              "Assessment recorded",
              () => setF(empty),
            );
          }}
        >
          <NativeSelect aria-label="Staff member" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
            <option value="">Staff member…</option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.displayName}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Area" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>
            <option value="">Test or section…</option>
            <optgroup label="Whole section">
              {departments.map((d) => (
                <option key={d.id} value={`department:${d.id}`}>
                  {d.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Test">
              {tests.map((t) => (
                <option key={t.id} value={`test:${t.id}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          </NativeSelect>
          <NativeSelect aria-label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as CompetencyMethod })}>
            {Object.entries(METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Outcome" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value as "competent" | "not_yet_competent" })}>
            <option value="competent">Competent</option>
            <option value="not_yet_competent">Not yet competent</option>
          </NativeSelect>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="competency-assessed">Assessed on</Label>
              <Input id="competency-assessed" type="date" value={f.assessedOn} onChange={(e) => setF({ ...f, assessedOn: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="competency-due">Next due (optional)</Label>
              <Input id="competency-due" type="date" value={f.nextDueOn} onChange={(e) => setF({ ...f, nextDueOn: e.target.value })} />
            </div>
          </div>
          <Textarea
            aria-label="Notes"
            placeholder={f.outcome === "not_yet_competent" ? "What needs work (required)" : "Notes (optional)"}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
          <Button type="submit" size="sm" className="self-start" disabled={pending || !f.userId || !f.area || !f.assessedOn || notesMissing}>
            Record assessment
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
