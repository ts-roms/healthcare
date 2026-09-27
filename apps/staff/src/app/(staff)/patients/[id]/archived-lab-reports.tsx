import { ArchiveIcon, FileTextIcon, HourglassIcon, TriangleAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { LabReportArchiveEntry } from "@/lib/api/types";
import { fileHref } from "@/lib/files";

const STATUS: Record<LabReportArchiveEntry["status"], { icon: typeof ArchiveIcon; text: string; className: string }> = {
  stored: { icon: ArchiveIcon, text: "Archived", className: "text-muted-foreground" },
  pending: { icon: HourglassIcon, text: "Being archived", className: "text-muted-foreground" },
  failed: { icon: TriangleAlertIcon, text: "Archiving failed", className: "text-warning-foreground" },
};

/**
 * Archived copies of the patient's released laboratory reports, as they were
 * released: one version per release of an order's results; a correction adds
 * a version and earlier ones stay available. Downloads are audited by the API.
 */
export function ArchivedLabReports({ archives }: { archives: LabReportArchiveEntry[] }) {
  if (archives.length === 0) return <p className="text-body text-muted-foreground">No archived laboratory reports yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Results</TableHead>
          <TableHead>Archived</TableHead>
          <TableHead className="w-36" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {archives.map((a) => {
          const status = STATUS[a.status];
          const Icon = status.icon;
          return (
            <TableRow key={a.id}>
              <TableCell className="font-mono">{a.orderNumber}</TableCell>
              <TableCell>
                v{a.archiveVersion}
                {a.corrected ? <span className="ml-1.5 text-meta text-warning-foreground">includes a correction</span> : null}
              </TableCell>
              <TableCell className="tabular">{a.resultCount}</TableCell>
              <TableCell className="tabular text-table">{clinicalDateTime(a.storedAt ?? a.createdAt)}</TableCell>
              <TableCell className="text-right">
                {a.status === "stored" ? (
                  <a
                    href={fileHref.archivedLabReport(a.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-table text-primary hover:underline"
                  >
                    <FileTextIcon className="size-3.5" aria-hidden /> Open PDF
                  </a>
                ) : (
                  <span className={`inline-flex items-center gap-1 text-meta ${status.className}`}>
                    <Icon className="size-3.5" aria-hidden /> {status.text}
                  </span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
