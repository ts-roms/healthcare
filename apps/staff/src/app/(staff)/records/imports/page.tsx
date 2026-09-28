import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { FhirImportListItem, FhirImportStatus } from "@/lib/api/types";
import { countsText, ImportStatus } from "./import-status";

export const metadata = { title: "Record imports" };

const VIEWS: Array<{ key: FhirImportStatus | "all"; label: string }> = [
  { key: "pending_review", label: "To review" },
  { key: "all", label: "All recent" },
];

/**
 * FHIR imports received from other systems. Nothing here is in a patient's record until a reviewer matches the
 * patient and accepts the entry. The list shows metadata only; opening an import is audited.
 */
export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "interop.fhir.import.review")) redirect("/");
  const view = params.view === "all" ? "all" : "pending_review";
  const imports = await api<FhirImportListItem[]>("/fhir-imports", { query: { status: view === "all" ? undefined : view } });
  return (
    <>
      <PageHeader
        title="Record imports"
        description="Records other providers sent as FHIR. Match the patient, then accept or reject each entry — nothing is added to a record automatically."
      />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="View" className="flex gap-1">
          {VIEWS.map((v) => (
            <Button key={v.key} asChild size="sm" variant={view === v.key ? "default" : "outline"}>
              <Link href={v.key === "pending_review" ? "/records/imports" : "/records/imports?view=all"} aria-current={view === v.key ? "page" : undefined}>
                {v.label}
              </Link>
            </Button>
          ))}
        </nav>
        <Card className="py-0">
          {imports.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">{view === "all" ? "No imports received yet." : "No imports waiting for review."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="whitespace-nowrap">{clinicalDateTime(i.receivedAt)}</TableCell>
                    <TableCell className="max-w-56 truncate text-meta" title={i.declaredSource ?? undefined}>
                      {i.declaredSource ?? <span className="text-muted-foreground">Not declared</span>}
                    </TableCell>
                    <TableCell className="text-meta">
                      {countsText(i.resourceCounts)}
                      {i.bundleType ? <span className="text-muted-foreground"> · {i.bundleType} bundle</span> : null}
                    </TableCell>
                    <TableCell>
                      {i.patient ? (
                        <>
                          {i.patient.displayName} <span className="text-muted-foreground">· {i.patient.patientNumber}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not matched</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ImportStatus status={i.status} />
                      {i.status === "pending_review" ? (
                        <div className="text-meta text-muted-foreground">
                          {i.pendingEntries} entr{i.pendingEntries === 1 ? "y" : "ies"} to review
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="xs" variant="outline">
                        <Link href={`/records/imports/${i.id}`}>{i.status === "pending_review" ? "Review" : "Open"}</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
