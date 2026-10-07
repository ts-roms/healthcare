"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ArchiveIcon, CheckCircle2Icon, Clock3Icon } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import type { AuditPartition, AuditRetention as AuditRetentionView } from "@/lib/api/types";
import { archiveAuditMonth, removeAuditMonth } from "./actions";

/** The month a partition covers, as people read it (its end is the first of the next month, excluded). */
function period(p: AuditPartition): string {
  if (p.isDefault) return "Outside every month (default)";
  if (!p.rangeFrom && p.rangeTo) return `Everything before ${clinicalDate(p.rangeTo)}`;
  if (p.rangeFrom) return new Date(p.rangeFrom).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" });
  return p.partitionName;
}

/** Colour, icon and text together (never colour alone). */
function ArchiveState({ p }: { p: AuditPartition }) {
  const a = p.archive;
  if (!a) return <span className="text-muted-foreground">Not archived</span>;
  if (a.removedAt) {
    return (
      <Badge variant="neutral">
        <ArchiveIcon className="size-3" aria-hidden /> Removed {clinicalDate(a.removedAt)}
      </Badge>
    );
  }
  if (a.status === "verified") {
    return (
      <span className="flex flex-col gap-0.5">
        <Badge variant="success">
          <CheckCircle2Icon className="size-3" aria-hidden /> Archived, {a.rowCount} events
        </Badge>
        <a className="text-meta text-primary hover:underline" href={`/admin/security/audit-archives/${a.id}`}>
          Download
        </a>
      </span>
    );
  }
  if (a.status === "failed") {
    return (
      <Badge variant="danger" title={a.lastError ?? undefined}>
        <AlertTriangleIcon className="size-3" aria-hidden /> Archive failed
      </Badge>
    );
  }
  return (
    <Badge variant="info">
      <Clock3Icon className="size-3" aria-hidden /> Archiving…
    </Badge>
  );
}

/**
 * Audit trail retention (platform administrators; docs/runbooks/audit-retention.md): the trail's monthly partitions,
 * archiving a closed month to object storage, and removing an archived month past the deployment's retention period.
 */
export function AuditRetention({ view }: { view: AuditRetentionView }) {
  const router = useRouter();
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const archive = (name: string) =>
    startTransition(async () => {
      const result = await archiveAuditMonth(name);
      if (result.ok) {
        toast.success("Archiving started; it is checked before it shows as archived");
        router.refresh();
      } else toast.error(result.message);
    });
  const remove = (name: string) =>
    startTransition(async () => {
      const result = await removeAuditMonth(name, reason);
      if (result.ok) {
        toast.success(`Removed ${result.data.removedEvents} events from the database; the archive stays`);
        setRemoving(null);
        setReason("");
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Audit trail retention</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-table">
        <p className="text-muted-foreground">
          The audit trail is kept in monthly parts for the whole platform (every organization&apos;s events share a month). A month that has ended can be
          archived to private storage as compressed JSON lines; the archive is read back and checked before it counts. An archived month can be removed from the
          database only once it is older than the retention period set for this deployment, and only with a reason. Removal is audited and the archive stays
          downloadable here.
        </p>
        <p>
          {view.retentionMonths
            ? `Retention period: ${view.retentionMonths} months (AUDIT_RETENTION_MONTHS).`
            : "No retention period is set (AUDIT_RETENTION_MONTHS): nothing is ever removed."}{" "}
          How long audit records must be kept is your organization&apos;s compliance decision.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Events (estimate)</TableHead>
              <TableHead>Archive</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.partitions.map((p) => (
              <TableRow key={p.partitionName}>
                <TableCell className="align-top">
                  <div className="font-medium">{period(p)}</div>
                  <div className="font-mono text-meta text-muted-foreground">{p.partitionName}</div>
                </TableCell>
                <TableCell className="align-top">{p.estimatedRows.toLocaleString("en-PH")}</TableCell>
                <TableCell className="align-top">
                  <ArchiveState p={p} />
                </TableCell>
                <TableCell className="min-w-64 align-top">
                  {p.archivable ? (
                    <Button size="xs" variant="outline" disabled={pending} onClick={() => archive(p.partitionName)}>
                      Archive
                    </Button>
                  ) : null}
                  {p.removable && removing !== p.partitionName ? (
                    <Button size="xs" variant="outline" disabled={pending} onClick={() => setRemoving(p.partitionName)}>
                      Remove from database…
                    </Button>
                  ) : null}
                  {removing === p.partitionName ? (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        remove(p.partitionName);
                      }}
                    >
                      <Label htmlFor={`reason-${p.partitionName}`}>Reason</Label>
                      <Input id={`reason-${p.partitionName}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
                      <div className="flex gap-2">
                        <Button size="xs" variant="destructive" type="submit" disabled={pending}>
                          Remove
                        </Button>
                        <Button size="xs" variant="ghost" type="button" onClick={() => setRemoving(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
