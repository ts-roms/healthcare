"use client";

import * as React from "react";
import { AlertOctagonIcon, BanIcon, CheckIcon, PrinterIcon, SaveIcon, ScanBarcodeIcon, SearchIcon } from "lucide-react";
import type { LabObservation, LabOrder } from "@healthcare/domain";
import { LaboratoryLayout } from "@healthcare/ui/layouts";
import { isCriticalFlag, LabOrderStatusBadge, LabResultTable, LabWorklist, sexLabel, SpecimenStatus } from "@healthcare/ui/healthcare";
import { Button, Input, Kbd, NativeSelect, toast } from "@healthcare/ui/primitives";

export function LabWorkbench({ orders: initial }: { orders: LabOrder[] }) {
  const [orders, setOrders] = React.useState(initial);
  const [query, setQuery] = React.useState("");
  const [dept, setDept] = React.useState("all");
  const [status, setStatus] = React.useState("open");
  const [selectedId, setSelectedId] = React.useState(initial[0]?.id);
  const scanRef = React.useRef<HTMLInputElement>(null);

  const shown = orders.filter(
    (o) =>
      (dept === "all" || o.department === dept) &&
      (status === "all" || (status === "open" ? !["verified", "rejected"].includes(o.status) : o.status === status)),
  );
  const selected = orders.find((o) => o.id === selectedId);

  const update = (id: string, patch: Partial<LabOrder>) => setOrders((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const setObservations = (obs: LabObservation[]) => selected && update(selected.id, { observations: obs });
  const hasCritical = selected?.observations.some((o) => isCriticalFlag(o.flag));

  // F2 focuses the barcode field: scanners type + Enter.
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

  return (
    <LaboratoryLayout
      status={
        <>
          <span className="tabular">{orders.filter((o) => !["verified", "rejected"].includes(o.status)).length} open</span>
          <span className="tabular font-semibold text-critical">
            ⚠ {orders.filter((o) => o.observations.some((x) => isCriticalFlag(x.flag))).length} critical
          </span>
        </>
      }
      toolbar={
        <>
          <div className="relative w-56">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search accession, patient or test"
              placeholder="Search accession / patient"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <form
            className="relative w-48"
            onSubmit={(e) => {
              e.preventDefault();
              const code = scanRef.current?.value.trim().toUpperCase();
              const hit = orders.find((o) => o.accession === code);
              if (hit) {
                setSelectedId(hit.id);
                scanRef.current!.value = "";
              } else toast.error(`No order for barcode ${code}`);
            }}
          >
            <ScanBarcodeIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input ref={scanRef} aria-label="Scan barcode" placeholder="Scan barcode" className="pr-9 pl-8 font-mono" />
            <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">F2</Kbd>
          </form>
          <NativeSelect aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="all">All departments</option>
            <option value="hematology">Hematology</option>
            <option value="chemistry">Chemistry</option>
            <option value="microscopy">Clinical microscopy</option>
            <option value="immunology">Immunology</option>
          </NativeSelect>
          <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="all">All statuses</option>
            <option value="processing">Processing</option>
            <option value="awaiting-verification">Awaiting verification</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </NativeSelect>
          <span className="ml-auto hidden text-meta text-muted-foreground md:inline">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> next result
          </span>
        </>
      }
      list={<LabWorklist orders={shown} filter={query} selectedId={selectedId} onSelect={(o) => setSelectedId(o.id)} />}
      detail={
        selected ? (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-section font-semibold">{selected.accession}</span>
              <LabOrderStatusBadge status={selected.status} />
              {selected.priority !== "routine" ? <span className="text-meta font-semibold text-critical uppercase">{selected.priority}</span> : null}
            </div>
            <dl className="grid grid-cols-[5rem_1fr] gap-y-1 text-table">
              <dt className="text-muted-foreground">Patient</dt>
              <dd className="font-medium">
                {selected.patientName}{" "}
                <span className="text-muted-foreground">
                  | {selected.patientAge} {sexLabel(selected.patientSex, true)}
                </span>
              </dd>
              <dt className="text-muted-foreground">Test</dt>
              <dd className="font-medium">{selected.test}</dd>
              <dt className="text-muted-foreground">Ordered by</dt>
              <dd>{selected.orderedBy}</dd>
              <dt className="text-muted-foreground">Specimen</dt>
              <dd>{selected.specimen ? <SpecimenStatus specimen={selected.specimen} /> : "—"}</dd>
            </dl>
            {selected.observations.length ? (
              <div className="rounded-md border bg-card">
                <LabResultTable observations={selected.observations} onChange={selected.status === "verified" ? undefined : setObservations} />
              </div>
            ) : (
              <p className="text-table text-muted-foreground">No results — specimen {selected.status === "rejected" ? "rejected" : "not yet processed"}.</p>
            )}
            {hasCritical ? (
              <p role="alert" className="flex items-center gap-2 rounded-md bg-critical px-2.5 py-2 text-table font-semibold text-critical-foreground">
                <AlertOctagonIcon className="size-4" aria-hidden /> Critical value — notify ordering physician and document read-back.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => toast.success(`${selected.accession} saved`)}>
                <SaveIcon /> Save
              </Button>
              <Button
                size="sm"
                variant="success"
                disabled={selected.status === "verified" || selected.status === "rejected"}
                onClick={() => {
                  update(selected.id, { status: "verified" });
                  toast.success(`${selected.accession} verified`);
                }}
              >
                <CheckIcon /> Verify
              </Button>
              <Button
                size="sm"
                variant="critical"
                onClick={() => toast.warning("Critical result call logged", { description: `${selected.orderedBy} notified` })}
              >
                <AlertOctagonIcon /> Critical
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-danger-foreground"
                disabled={selected.status === "verified" || selected.status === "rejected"}
                onClick={() => {
                  update(selected.id, { status: "rejected" });
                  toast.error(`${selected.accession} rejected`);
                }}
              >
                <BanIcon /> Reject
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.print()}>
                <PrinterIcon /> Print
              </Button>
            </div>
          </div>
        ) : (
          <p className="p-3 text-muted-foreground">Select an order.</p>
        )
      }
    />
  );
}
