import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, GitMergeIcon, InfoIcon, SearchIcon } from "lucide-react";
import { clinicalDate, sexLabel } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { ApiError, userMessage } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { Page, PatientDetail, PatientSummary } from "@/lib/api/types";
import { label } from "@/lib/patient-mapping";

// Never put patient names in the tab title.
export const metadata = { title: "Merge duplicate record" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Merging a duplicate, step 1: find the other record and choose which one survives. The next step compares both
 * side by side (differences, work in progress) before anything changes.
 */
export default async function MergePickPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ id }, { q = "" }, session] = await Promise.all([params, searchParams, getSession()]);
  if (!UUID.test(id) || !can(session, "patient.merge")) notFound();
  const patient = await api<PatientDetail>(`/patients/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const query = q.trim();
  let results: PatientSummary[] = [];
  let error: string | null = null;
  if (query.length >= 2) {
    try {
      const page = await api<Page<PatientSummary>>("/patients", { query: { q: query, includeInactive: "true", pageSize: 25 } });
      results = page.items.filter((r) => r.id !== id);
    } catch (e) {
      error = userMessage(e);
    }
  }

  return (
    <>
      <PageHeader
        title="Merge duplicate record"
        description={
          <>
            {patient.displayName} · <span className="font-mono">{patient.patientNumber}</span> · born {clinicalDate(patient.birthDate)}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/patients/${id}`}>
              <ArrowLeftIcon aria-hidden /> Patient record
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        {patient.mergedIntoPatientId ? (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-warning-foreground">
            This record is already merged into another patient. Open the surviving record to merge further duplicates.
          </p>
        ) : (
          <>
            <p className="flex items-start gap-2 text-body text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              Find the other record of the same person. Nothing is moved: the retired record keeps everything filed under it, marked with its number, and every
              screen of the surviving record shows both. A merge can be undone.
            </p>
            <form role="search" action={`/patients/${id}/merge`} className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1">
                <span className="text-meta font-medium text-muted-foreground">Name, patient no. or mobile</span>
                <Input name="q" defaultValue={query} className="w-72" autoFocus={!query} />
              </label>
              <Button type="submit" size="sm">
                <SearchIcon /> Search
              </Button>
            </form>
            {error ? (
              <p role="alert" className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-danger-foreground">
                {error}
              </p>
            ) : query.length >= 2 && results.length === 0 ? (
              <p className="text-muted-foreground">No other record matches.</p>
            ) : results.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Patient no.</TableHead>
                    <TableHead>Birth date</TableHead>
                    <TableHead>Age / Sex</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Which record survives?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.displayName}</TableCell>
                      <TableCell className="font-mono">{r.patientNumber}</TableCell>
                      <TableCell>{clinicalDate(r.birthDate)}</TableCell>
                      <TableCell>
                        {r.age} {sexLabel(r.sex, true)}
                      </TableCell>
                      <TableCell>{r.status === "active" ? "Active" : <Badge variant="warning">{label(r.status)}</Badge>}</TableCell>
                      <TableCell>
                        {r.status === "merged" ? (
                          <span className="text-meta text-muted-foreground">Already merged</span>
                        ) : (
                          <span className="flex flex-wrap gap-1.5">
                            <Button asChild size="xs">
                              <Link href={`/patients/${r.id}/merge/${id}`}>
                                <GitMergeIcon aria-hidden /> Keep {patient.patientNumber}
                              </Link>
                            </Button>
                            <Button asChild size="xs" variant="outline">
                              <Link href={`/patients/${id}/merge/${r.id}`}>
                                <GitMergeIcon aria-hidden /> Keep {r.patientNumber}
                              </Link>
                            </Button>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
