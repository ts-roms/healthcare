import Link from "next/link";
import { SearchIcon, UserPlusIcon } from "lucide-react";
import { Badge, Button, DateInput, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { clinicalDate, sexLabel } from "@healthcare/ui/healthcare";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { ApiError, userMessage } from "@healthcare/web-session";
import { can, getSession } from "@/lib/api/session";
import type { Page, PatientSummary } from "@/lib/api/types";
import { label } from "@/lib/patient-mapping";

export const metadata = { title: "Patients" };

const PAGE_SIZE = 25;

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string; birthDate?: string; page?: string }> }) {
  const { q = "", birthDate = "", page: pageParam } = await searchParams;
  const session = await getSession();
  const canOpenWorkspace = can(session, "patient.read");
  const page = Math.max(1, Number(pageParam) || 1);
  const query = q.trim();
  const hasCriteria = query.length >= 2 || Boolean(birthDate);

  let result: Page<PatientSummary> | undefined;
  let error: string | undefined;
  if (hasCriteria) {
    try {
      result = await api<Page<PatientSummary>>("/patients", {
        query: { q: query.length >= 2 ? query : undefined, birthDate: birthDate || undefined, page, pageSize: PAGE_SIZE },
      });
    } catch (e) {
      error = e instanceof ApiError && e.status === 403 ? "You don't have permission to search patients." : userMessage(e);
    }
  }

  const pageHref = (p: number) => `/patients?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(birthDate ? { birthDate } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Patients"
        description="Look up by name, patient number or mobile number, optionally with birth date."
        actions={
          can(session, "patient.register") ? (
            <Button asChild size="sm">
              <Link href="/patients/new">
                <UserPlusIcon /> Register patient
              </Link>
            </Button>
          ) : null
        }
      />
      <form role="search" className="flex flex-wrap items-end gap-2 border-b bg-card px-4 py-3" action="/patients">
        <label className="grid gap-1">
          <span className="text-meta font-medium text-muted-foreground">Name, patient no. or mobile</span>
          <Input name="q" defaultValue={query} placeholder="e.g. dela cruz juan" className="w-72" autoFocus={!query} />
        </label>
        <label className="grid gap-1">
          <span className="text-meta font-medium text-muted-foreground">Birth date</span>
          <DateInput name="birthDate" defaultValue={birthDate} className="w-44" />
        </label>
        <Button type="submit" size="sm">
          <SearchIcon /> Search
        </Button>
      </form>

      {!hasCriteria ? (
        <p className="p-6 text-center text-muted-foreground">
          {query.length === 1 ? "Enter at least 2 characters." : "Search to find a patient. Results show only what's needed to identify the right person."}
        </p>
      ) : error ? (
        <p role="alert" className="m-4 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-danger-foreground">
          {error}
        </p>
      ) : result && result.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 p-8 text-center text-muted-foreground">
          <p>No patients match. Check the spelling, or try the birth date or mobile number.</p>
          {can(session, "patient.register") ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/patients/new">
                <UserPlusIcon /> Register a new patient
              </Link>
            </Button>
          ) : null}
        </div>
      ) : result ? (
        <div className="bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Patient no.</TableHead>
                <TableHead>Birth date</TableHead>
                <TableHead>Age / Sex</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/patients/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.displayName}
                    </Link>
                    {canOpenWorkspace ? (
                      <Link
                        href={`/patients/${p.id}/360`}
                        className="ml-2 text-meta text-primary hover:underline"
                        aria-label={`Patient 360 for ${p.displayName}`}
                      >
                        360
                      </Link>
                    ) : null}
                    {p.resolvedFrom ? (
                      <span className="block text-meta text-muted-foreground">
                        Found through <span className="font-mono">{p.resolvedFrom.patientNumber}</span>, merged into this record
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono">{p.patientNumber}</TableCell>
                  <TableCell>{clinicalDate(p.birthDate)}</TableCell>
                  <TableCell>
                    {p.age} {sexLabel(p.sex, true)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.primaryMobileMasked ?? "—"}</TableCell>
                  <TableCell>
                    {p.status === "active" ? <span className="text-muted-foreground">Active</span> : <Badge variant="warning">{label(p.status)}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <nav aria-label="Pagination" className="flex items-center justify-between border-t px-4 py-2 text-table">
            <span className="text-muted-foreground">Page {result.page}</span>
            <span className="flex gap-2">
              {result.page > 1 ? (
                <Button asChild variant="outline" size="xs">
                  <Link href={pageHref(result.page - 1)}>Previous</Link>
                </Button>
              ) : null}
              {result.hasMore ? (
                <Button asChild variant="outline" size="xs">
                  <Link href={pageHref(result.page + 1)}>Next</Link>
                </Button>
              ) : null}
            </span>
          </nav>
        </div>
      ) : null}
    </>
  );
}
