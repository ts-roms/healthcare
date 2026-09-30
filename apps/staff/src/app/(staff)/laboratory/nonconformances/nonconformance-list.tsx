"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import {
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
  toast,
} from "@healthcare/ui/primitives";
import type { LabInstrument, LabNonconformance, NonconformanceCategory, NonconformanceSeverity } from "@/lib/api/types";
import { reportNonconformance } from "../quality-management-actions";
import { CATEGORY_LABEL, NonconformanceStatusBadge, SEVERITY_LABEL, SeverityBadge } from "../quality-ui";

export function NonconformanceList({ records, instruments, canReport }: { records: LabNonconformance[]; instruments: LabInstrument[]; canReport: boolean }) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Records</CardTitle>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="text-body text-muted-foreground">Nothing here.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">
                      <Link href={`/laboratory/nonconformances/${r.id}`} className="text-primary hover:underline">
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.title}
                      <span className="block text-meta text-muted-foreground">
                        {CATEGORY_LABEL[r.category]}
                        {r.instrumentName ? ` · ${r.instrumentName}` : ""}
                        {r.specimenAccession ? ` · specimen ${r.specimenAccession}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={r.severity} />
                    </TableCell>
                    <TableCell>
                      <NonconformanceStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="tabular text-table">
                      {clinicalDateTime(r.reportedAt)}
                      <span className="block text-meta text-muted-foreground">{r.reportedByName ?? "Platform"}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canReport ? <ReportForm instruments={instruments} /> : null}
    </div>
  );
}

function ReportForm({ instruments }: { instruments: LabInstrument[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const empty = {
    category: "pre_analytical" as NonconformanceCategory,
    severity: "minor" as NonconformanceSeverity,
    title: "",
    description: "",
    instrumentId: "",
    specimenAccession: "",
  };
  const [f, setF] = React.useState(empty);
  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>Report a nonconformance</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await reportNonconformance({ ...f, instrumentId: f.instrumentId || undefined });
              if (!result.ok) return void toast.error(result.message);
              toast.success(`${result.data.number} reported`);
              setF(empty);
              router.push(`/laboratory/nonconformances/${result.data.id}`);
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="nc-category">Category</Label>
              <NativeSelect id="nc-category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as NonconformanceCategory })}>
                {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="nc-severity">Severity</Label>
              <NativeSelect id="nc-severity" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as NonconformanceSeverity })}>
                {Object.entries(SEVERITY_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="nc-title">Title *</Label>
            <Input id="nc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="nc-description">What happened *</Label>
            <Textarea id="nc-description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={4000} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="nc-instrument">Instrument (optional)</Label>
            <NativeSelect
              emptyText="No instruments registered"
              id="nc-instrument"
              value={f.instrumentId}
              onChange={(e) => setF({ ...f, instrumentId: e.target.value })}
            >
              <option value="">None</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="nc-accession">Specimen accession (optional)</Label>
            <Input id="nc-accession" className="font-mono" value={f.specimenAccession} onChange={(e) => setF({ ...f, specimenAccession: e.target.value })} />
          </div>
          <Button type="submit" size="sm" className="self-start" disabled={pending || f.title.trim().length < 3 || f.description.trim().length < 3}>
            <PlusIcon /> Report
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
