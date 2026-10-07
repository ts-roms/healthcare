import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, CircleHelpIcon, FileXIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { IntegrityFinding, IntegrityFindings, IntegrityRun, IntegrityRunList } from "@/lib/api/types";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/records-mapping";
import { CancelRunButton, ResolveFindingForm, StartRunForm } from "./integrity-forms";

export const metadata = { title: "Document integrity" };

const label = (category: string | null) => (category ? (DOCUMENT_CATEGORY_LABEL[category] ?? category) : "All categories");

const RUN_STATUS: Record<IntegrityRun["status"], { text: string; variant: "info" | "success" | "danger" | "neutral" }> = {
  queued: { text: "Queued", variant: "info" },
  running: { text: "Running", variant: "info" },
  completed: { text: "Completed", variant: "success" },
  failed: { text: "Failed", variant: "danger" },
  cancelled: { text: "Stopped", variant: "neutral" },
};

/** Colour, icon and text together (never colour alone). */
function Outcome({ outcome }: { outcome: IntegrityFinding["outcome"] }) {
  if (outcome === "mismatch") {
    return (
      <Badge variant="danger">
        <AlertTriangleIcon className="size-3" aria-hidden /> File changed
      </Badge>
    );
  }
  if (outcome === "missing") {
    return (
      <Badge variant="danger">
        <FileXIcon className="size-3" aria-hidden /> File missing
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
      <CircleHelpIcon className="size-3" aria-hidden /> Storage did not answer
    </Badge>
  );
}

function FindingsTable({ findings, resolved }: { findings: IntegrityFinding[]; resolved: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Found</TableHead>
          <TableHead>Document</TableHead>
          <TableHead>What was found</TableHead>
          <TableHead>{resolved ? "Decision" : ""}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {findings.map((f) => (
          <TableRow key={f.id}>
            <TableCell className="align-top whitespace-nowrap">{clinicalDateTime(f.foundAt)}</TableCell>
            <TableCell className="align-top">
              <div className="font-medium">{f.document.title}</div>
              <div className="text-meta text-muted-foreground">
                {label(f.document.category)} · {f.document.fileName}
                {f.document.managedBy ? ` · managed by ${f.document.managedBy}` : ""}
                {f.document.status !== "available" ? ` · ${f.document.status}` : ""}
              </div>
              {f.document.patientId ? (
                <Link className="text-meta text-primary hover:underline" href={`/patients/${f.document.patientId}`}>
                  Patient record
                </Link>
              ) : null}
            </TableCell>
            <TableCell className="align-top">
              <Outcome outcome={f.outcome} />
              {f.outcome === "mismatch" ? (
                <div className="mt-1 font-mono text-meta text-muted-foreground">
                  recorded {f.recordedSha256?.slice(0, 12)}… · found {f.computedSha256?.slice(0, 12)}…
                </div>
              ) : null}
            </TableCell>
            <TableCell className="min-w-64 align-top">
              {resolved ? (
                <div className="text-body">
                  {f.resolutionNote}
                  <div className="text-meta text-muted-foreground">{f.resolvedAt ? clinicalDateTime(f.resolvedAt) : null}</div>
                </div>
              ) : (
                <ResolveFindingForm findingId={f.id} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Integrity review of stored documents: the records office reads every available document back from storage and
 * compares it with the checksum recorded when it was stored. A document whose file changed or is missing is withheld
 * from everyone until the finding is resolved here. Nothing is repaired or deleted by the platform.
 */
export default async function IntegrityPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "document.integrity.manage")) redirect("/");
  const view = params.view === "resolved" ? "resolved" : "open";
  const [runs, findings] = await Promise.all([
    api<IntegrityRunList>("/document-integrity/runs"),
    api<IntegrityFindings>("/document-integrity/findings", { query: { status: view } }),
  ]);
  const active = runs.runs.find((r) => r.status === "queued" || r.status === "running");
  return (
    <>
      <PageHeader
        title="Document integrity"
        description="Checks that every stored document still matches the checksum recorded when it was stored, and what to do about the ones that do not."
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="rounded-md border border-dashed p-3 text-meta text-muted-foreground">
          A review reads each available document back from storage and compares it with its recorded checksum. A document whose file has changed or is missing
          is withheld from everyone — staff, MyHealth and other systems — until you record a decision here. The platform never repairs, replaces or deletes a
          file: restoring one from a backup, or archiving the document with a reason, is your organization&apos;s own procedure. Documents stored before
          checksums existed are given a baseline on their first review and verified from the next one.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Reviews</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <StartRunForm disabled={Boolean(active)} />
            {active ? <p className="text-meta text-muted-foreground">A review is in progress; start the next one when it has finished.</p> : null}
            {runs.runs.length === 0 ? (
              <p className="text-body text-muted-foreground">No review has been run yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Checked</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead>Baselined</TableHead>
                    <TableHead>Changed</TableHead>
                    <TableHead>Missing</TableHead>
                    <TableHead>Not read</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{clinicalDateTime(r.requestedAt)}</TableCell>
                      <TableCell>{label(r.category)}</TableCell>
                      <TableCell>
                        <Badge variant={RUN_STATUS[r.status].variant}>
                          {r.status === "completed" ? <CheckCircle2Icon className="size-3" aria-hidden /> : null}
                          {RUN_STATUS[r.status].text}
                        </Badge>
                        {r.status === "failed" && r.lastError ? <div className="text-meta text-muted-foreground">{r.lastError}</div> : null}
                      </TableCell>
                      <TableCell>{r.checked}</TableCell>
                      <TableCell>{r.verified}</TableCell>
                      <TableCell>{r.baselined}</TableCell>
                      <TableCell>{r.mismatched}</TableCell>
                      <TableCell>{r.missing}</TableCell>
                      <TableCell>{r.unreadable}</TableCell>
                      <TableCell className="text-right">{r.status === "queued" || r.status === "running" ? <CancelRunButton runId={r.id} /> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{view === "open" ? `Open findings (${runs.openFindings})` : "Resolved findings"}</CardTitle>
            <Button asChild size="xs" variant="ghost" className="ml-auto">
              <Link href={view === "open" ? "/records/integrity?view=resolved" : "/records/integrity"}>{view === "open" ? "Show resolved" : "Show open"}</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {findings.findings.length === 0 ? (
              <p className="text-body text-muted-foreground">{view === "open" ? "Nothing to resolve." : "No finding has been resolved yet."}</p>
            ) : (
              <FindingsTable findings={findings.findings} resolved={view === "resolved"} />
            )}
            {findings.more ? <p className="text-meta text-muted-foreground">Showing the first 200.</p> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
