import * as React from "react";
import { cn } from "../lib/utils";

/** Dense data table. 13px, compact rows, sticky tinted header with rounded ends, zebra-free (uses row hover + selection instead). */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-auto">
      <table data-slot="table" className={cn("tabular w-full caption-bottom text-table", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky top-0 z-10 bg-primary-subtle/60 [&_tr]:border-b-0 [&_tr>th:first-child]:rounded-l-lg [&_tr>th:last-child]:rounded-r-lg", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr data-slot="table-row" className={cn("border-b transition-colors hover:bg-accent/60 data-[state=selected]:bg-primary-subtle", className)} {...props} />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn("h-9 px-3 text-left align-middle text-table font-semibold whitespace-nowrap text-primary-deep", className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("px-3 py-2 align-middle whitespace-nowrap", className)} {...props} />;
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("mt-2 text-meta text-muted-foreground", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption };
