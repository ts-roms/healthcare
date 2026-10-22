import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

export interface ResponsiveColumn<T> {
  key: string;
  header: React.ReactNode;
  /** The cell. On a phone it sits under `header` (as its label) inside the row's card. */
  cell: (row: T) => React.ReactNode;
  /** The row's headline on a phone (the card title, shown without a label). One column. */
  primary?: boolean;
  /** Right-align numbers and amounts. */
  numeric?: boolean;
  /** The row's actions: last column on desktop, a footer on the card. Not labelled. */
  actions?: boolean;
  /** Left out of the phone card (a column the card repeats elsewhere). */
  hideOnMobile?: boolean;
  className?: string;
}

/**
 * A data table that becomes a list of cards below `md`, so no screen scrolls sideways on a phone. Both layouts are
 * rendered and CSS shows one, so it works in server components and never flashes. Columns are metadata
 * (`primary`, `actions`, `numeric`, `hideOnMobile`); pass `mobileRow` to draw the card yourself.
 * `urgent` rows (STAT, critical, overdue, emergency) get a danger edge, an icon and "Urgent" text, and belong first in `rows`.
 */
function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  urgent,
  mobileRow,
  className,
}: {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Names the table for assistive technology. */
  caption: string;
  urgent?: (row: T) => boolean;
  mobileRow?: (row: T) => React.ReactNode;
  className?: string;
}) {
  const primary = columns.find((c) => c.primary) ?? columns.find((c) => !c.actions);
  const actions = columns.find((c) => c.actions);
  const detail = columns.filter((c) => c !== primary && c !== actions && !c.hideOnMobile);
  return (
    <div data-slot="responsive-table" className={className}>
      <div className="hidden md:block">
        <Table aria-label={caption}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(c.numeric && "text-right", c.actions && "text-right", c.className)}>
                  {c.actions ? <span className="sr-only">{c.header}</span> : c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isUrgent = urgent?.(row) ?? false;
              return (
                <TableRow key={getRowKey(row)} className={cn(isUrgent && "bg-danger-subtle/40 shadow-[inset_3px_0_0_var(--danger)]")}>
                  {columns.map((c, i) => (
                    <TableCell key={c.key} className={cn(c.numeric && "text-right", c.actions && "text-right", c.className)}>
                      {i === 0 && isUrgent ? (
                        <span className="inline-flex items-center gap-1.5">
                          <TriangleAlertIcon className="size-4 shrink-0 text-danger-foreground" aria-hidden />
                          <span className="sr-only">Urgent: </span>
                          {c.cell(row)}
                        </span>
                      ) : (
                        c.cell(row)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ul className="grid gap-2 md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const isUrgent = urgent?.(row) ?? false;
          return (
            <li
              key={getRowKey(row)}
              className={cn(
                "rounded-xl border bg-card p-3 text-body shadow-xs",
                isUrgent && "border-danger/40 bg-danger-subtle/40 shadow-[inset_3px_0_0_var(--danger)]",
              )}
            >
              {mobileRow ? (
                mobileRow(row)
              ) : (
                <>
                  {primary ? (
                    <div className="flex items-start gap-2 font-semibold">
                      {isUrgent ? (
                        <>
                          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-danger-foreground" aria-hidden />
                          <span className="sr-only">Urgent: </span>
                        </>
                      ) : null}
                      <div className="min-w-0">{primary.cell(row)}</div>
                    </div>
                  ) : null}
                  {detail.length > 0 ? (
                    <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-table">
                      {detail.map((c) => (
                        <React.Fragment key={c.key}>
                          <dt className="text-muted-foreground">{c.header}</dt>
                          <dd className={cn("min-w-0 break-words", c.numeric && "tabular text-right")}>{c.cell(row)}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  ) : null}
                  {actions ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2">{actions.cell(row)}</div> : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { ResponsiveTable };
