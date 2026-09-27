"use client";

import * as React from "react";
import { type ColumnDef, type SortingState, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { ArrowUpDownIcon, ZapIcon } from "lucide-react";
import type { LabOrder } from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../primitives/table";
import { clinicalTime, sexLabel } from "../lib/format";
import { cn } from "../lib/utils";
import { LabOrderStatusBadge } from "./specimen-status";
import { isCriticalFlag } from "./status";

const PRIORITY_RANK = { stat: 0, urgent: 1, routine: 2 } as const;

const columns: ColumnDef<LabOrder>[] = [
  {
    accessorKey: "accession",
    header: "Accession",
    cell: ({ getValue }) => <span className="font-mono font-medium">{getValue<string>()}</span>,
  },
  {
    accessorKey: "priority",
    header: "Pri",
    sortingFn: (a, b) => PRIORITY_RANK[a.original.priority] - PRIORITY_RANK[b.original.priority],
    cell: ({ row }) =>
      row.original.priority === "routine" ? (
        <span className="text-muted-foreground">Routine</span>
      ) : (
        <Badge variant={row.original.priority === "stat" ? "critical" : "warning"}>
          <ZapIcon aria-hidden />
          {row.original.priority.toUpperCase()}
        </Badge>
      ),
  },
  {
    accessorKey: "patientName",
    header: "Patient",
    cell: ({ row }) => (
      <span>
        {row.original.patientName}{" "}
        <span className="tabular text-muted-foreground">
          {row.original.patientAge} {sexLabel(row.original.patientSex, true)}
        </span>
      </span>
    ),
  },
  { accessorKey: "test", header: "Test", cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
  { accessorKey: "department", header: "Dept", cell: ({ getValue }) => <span className="text-muted-foreground capitalize">{getValue<string>()}</span> },
  {
    id: "collected",
    header: "Collected",
    accessorFn: (o) => o.specimen?.collectedAt ?? "",
    cell: ({ getValue }) => <span className="tabular text-muted-foreground">{getValue<string>() ? clinicalTime(getValue<string>()) : "—"}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="flex items-center gap-1">
        <LabOrderStatusBadge status={row.original.status} />
        {row.original.observations.some((o) => isCriticalFlag(o.flag)) ? <Badge variant="critical">⚠ Critical</Badge> : null}
      </span>
    ),
  },
];

export interface LabWorklistProps {
  orders: LabOrder[];
  selectedId?: string;
  onSelect?: (order: LabOrder) => void;
  /** Free-text filter across accession, patient and test (e.g. barcode scan input). */
  filter?: string;
  className?: string;
}

/**
 * High-density lab worklist. ↑/↓ or j/k move selection; rows are one line;
 * default sort puts STAT first. Built on TanStack Table.
 */
export function LabWorklist({ orders, selectedId, onSelect, filter = "", className }: LabWorklistProps) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "priority", desc: false }]);
  const table = useReactTable({
    data: orders,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    getRowId: (o) => o.id,
    globalFilterFn: (row, _col, value: string) => {
      const q = value.toLowerCase();
      const o = row.original;
      return [o.accession, o.patientName, o.test].some((f) => f.toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const rows = table.getRowModel().rows;

  const move = (delta: number) => {
    const idx = rows.findIndex((r) => r.id === selectedId);
    const next = rows[Math.min(Math.max(idx + delta, 0), rows.length - 1)];
    if (next) {
      onSelect?.(next.original);
      document.getElementById(`worklist-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <div
      tabIndex={0}
      role="grid"
      aria-label="Lab worklist"
      aria-rowcount={rows.length}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "j") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowUp" || e.key === "k") {
          e.preventDefault();
          move(-1);
        }
      }}
      className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}
    >
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead key={h.id}>
                  {h.isPlaceholder ? null : (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={h.column.getToggleSortingHandler()}
                      className="inline-flex items-center gap-1 uppercase hover:text-foreground"
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <ArrowUpDownIcon className="size-3 opacity-50" aria-hidden />
                    </button>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                No orders match.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const critical = row.original.observations.some((o) => isCriticalFlag(o.flag));
              return (
                <TableRow
                  key={row.id}
                  id={`worklist-row-${row.id}`}
                  aria-selected={row.id === selectedId}
                  data-state={row.id === selectedId ? "selected" : undefined}
                  onClick={() => onSelect?.(row.original)}
                  className={cn("cursor-pointer", critical && "shadow-[inset_3px_0_0_var(--critical)]")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
