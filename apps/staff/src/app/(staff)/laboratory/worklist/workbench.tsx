"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertOctagonIcon, ScanBarcodeIcon, TruckIcon, ZapIcon } from "lucide-react";
import { LaboratoryLayout } from "@healthcare/ui/layouts";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Kbd, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@healthcare/ui/primitives";
import type { LabCatalogEntry, LabDashboard, LabInstrument, LabSpecimenType, LabWorklistRow, LabWorklistStage, ReferenceLaboratory } from "@/lib/api/types";
import { LiveIndicator, useLabUpdates } from "@/components/live-queue";
import { PRIORITY_LABEL, STAGES } from "@/lib/lab-mapping";
import { findByAccession } from "../actions";
import { type LabPermissions, WorkbenchDetail } from "./workbench-detail";

export function LabWorkbench({
  facilityName,
  stage,
  departmentId,
  rows,
  dashboard,
  departments,
  specimenTypes,
  instruments,
  referenceLabs,
  permissions,
}: {
  facilityName: string;
  stage: LabWorklistStage;
  departmentId: string | null;
  rows: LabWorklistRow[];
  dashboard: LabDashboard | null;
  departments: LabCatalogEntry[];
  specimenTypes: LabSpecimenType[];
  /** Active instruments at the facility, for result entry. */
  instruments: LabInstrument[];
  referenceLabs: ReferenceLaboratory[];
  permissions: LabPermissions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [selectedKey, setSelectedKey] = React.useState<string | null>(rows[0]?.key ?? null);
  const [scanned, setScanned] = React.useState<LabWorklistRow | null>(null);
  const [scanning, startScan] = React.useTransition();
  const scanRef = React.useRef<HTMLInputElement>(null);
  const selected = scanned ?? rows.find((r) => r.key === selectedKey) ?? null;
  // Other benches' work (collection, receipt, sign-off) shows up without reloading; polling while the socket is down.
  const live = useLabUpdates();
  const specimenTypeName = React.useMemo(() => new Map(specimenTypes.map((s) => [s.id, s.name])), [specimenTypes]);

  // F2 focuses the barcode field: scanners type the accession number and Enter.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        scanRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const href = (next: { stage?: LabWorklistStage; department?: string | null }) => {
    const params = new URLSearchParams();
    params.set("stage", next.stage ?? stage);
    const department = next.department === undefined ? departmentId : next.department;
    if (department) params.set("department", department);
    return `${pathname}?${params}`;
  };

  const scan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanRef.current?.value ?? "";
    startScan(async () => {
      const result = await findByAccession(code);
      if (!result.ok) return void toast.error(result.message);
      if (!result.data) return void toast.error(`No specimen ${code.trim()} at ${facilityName}.`);
      const { specimen, order } = result.data;
      const { items, specimens: _specimens, patient, ...orderFields } = order;
      setScanned({ key: specimen.id, order: orderFields, patient, specimen, items: items.filter((i) => i.specimenId === specimen.id) });
      if (scanRef.current) scanRef.current.value = "";
    });
  };

  const afterChange = () => {
    // Scanned specimens are looked up again on the next scan; the worklist re-reads from the server.
    setScanned(null);
    router.refresh();
  };

  return (
    <LaboratoryLayout
      title={`Laboratory · ${facilityName}`}
      status={
        <>
          <LiveIndicator status={live} />
          {dashboard ? (
            <>
              <span className="tabular">{dashboard.statOpen} STAT open</span>
              {dashboard.overdue ? <span className="tabular text-warning-foreground">{dashboard.overdue} past turnaround</span> : null}
              {dashboard.sendOutsToDispatch || dashboard.sendOutsAwaitingResults ? (
                <Link href="/laboratory/send-outs" className="inline-flex items-center gap-1 hover:underline">
                  <TruckIcon className="size-4" aria-hidden />
                  <span className="tabular">
                    {dashboard.sendOutsToDispatch} to dispatch · {dashboard.sendOutsAwaitingResults} at reference labs
                    {dashboard.sendOutsOverdue ? ` (${dashboard.sendOutsOverdue} overdue)` : ""}
                  </span>
                </Link>
              ) : null}
              {dashboard.criticalUnacknowledged ? (
                <Link href="/laboratory/critical" className="inline-flex items-center gap-1 font-semibold text-critical hover:underline">
                  <AlertOctagonIcon className="size-4" aria-hidden /> {dashboard.criticalUnacknowledged} critical unacknowledged
                </Link>
              ) : null}
            </>
          ) : null}
        </>
      }
      toolbar={
        <>
          <nav aria-label="Worklist stage" className="flex flex-wrap gap-1">
            {STAGES.map((s) => (
              <Link
                key={s.stage}
                href={href({ stage: s.stage })}
                aria-current={s.stage === stage ? "page" : undefined}
                className={`rounded-md border px-2.5 py-1 text-table ${s.stage === stage ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
              >
                {s.label}
                {dashboard ? <span className="tabular ml-1.5 opacity-80">{s.count(dashboard)}</span> : null}
              </Link>
            ))}
          </nav>
          <NativeSelect aria-label="Department" value={departmentId ?? ""} onChange={(e) => router.push(href({ department: e.target.value || null }))}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
          <form className="relative w-56" onSubmit={scan}>
            <ScanBarcodeIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={scanRef}
              aria-label="Scan accession barcode"
              placeholder="Scan accession"
              className="pr-9 pl-8 font-mono"
              disabled={scanning}
              inputMode="numeric"
            />
            <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">F2</Kbd>
          </form>
        </>
      }
      list={
        rows.length === 0 ? (
          <p className="p-4 text-body text-muted-foreground">Nothing waiting at this stage{departmentId ? " in this department" : ""}.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Priority</TableHead>
                <TableHead>{stage === "collect" ? "Order" : "Accession"}</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Tests</TableHead>
                <TableHead className="text-right">{stage === "collect" ? "Ordered" : "Collected"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.key}
                  data-state={selected?.key === row.key ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => {
                    setScanned(null);
                    setSelectedKey(row.key);
                  }}
                >
                  <TableCell>
                    {row.order.priority === "stat" ? (
                      <Badge variant="critical">
                        <ZapIcon aria-hidden /> STAT
                      </Badge>
                    ) : (
                      <span className="text-meta text-muted-foreground">{PRIORITY_LABEL[row.order.priority]}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="h-auto px-0 font-mono text-table text-foreground"
                      aria-label={`Open ${row.specimen?.accessionNumber ?? row.order.orderNumber}`}
                    >
                      {row.specimen?.accessionNumber ?? row.order.orderNumber}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{row.patient?.displayName ?? "Patient"}</span>
                    <span className="block text-meta text-muted-foreground">{row.patient ? `${row.patient.patientNumber} · ${row.patient.age} y` : null}</span>
                  </TableCell>
                  <TableCell className="text-table">
                    {row.items.map((i) => i.testName).join(", ")}
                    {stage === "collect" ? (
                      <span className="block text-meta text-muted-foreground">
                        {[...new Set(row.items.map((i) => specimenTypeName.get(i.specimenTypeId) ?? "Specimen"))].join(" · ")}
                        {row.order.fastingRequired ? " · fasting" : ""}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular text-right">{clinicalTime(row.specimen?.collectedAt ?? row.order.orderedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
      detail={
        selected ? (
          <WorkbenchDetail
            key={`${selected.key}:${stage}:${scanned ? "scan" : "list"}`}
            row={selected}
            stage={scanned ? null : stage}
            permissions={permissions}
            specimenTypeName={specimenTypeName}
            instruments={instruments}
            referenceLabs={referenceLabs}
            onChanged={afterChange}
          />
        ) : (
          <p className="p-4 text-table text-muted-foreground">Select a row or scan a specimen barcode.</p>
        )
      }
    />
  );
}
