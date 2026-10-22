import type { ReactNode } from "react";
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";

/** A headline figure with one line under it saying what it counts (operational screens: stock value, reagent use). */
export function Figure({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <Card className="p-3">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="tabular text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-meta text-muted-foreground">{children}</p>
    </Card>
  );
}

/** A small read-only table of figures: the first column left-aligned, the others right-aligned; a line of text when empty. */
export function SimpleTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-table text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h, i) => (
            <TableHead key={`${h}-${i}`} className={i === 0 ? undefined : "text-right"}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, r) => (
          <TableRow key={r}>
            {row.map((cell, i) => (
              <TableCell key={i} className={i === 0 ? undefined : "tabular text-right"}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
