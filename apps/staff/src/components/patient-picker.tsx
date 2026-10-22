import Link from "next/link";
import { SearchIcon, UserPlusIcon } from "lucide-react";
import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { clinicalDate, sexLabel } from "@healthcare/ui/healthcare";
import { api } from "@/lib/api/client";
import { ApiError, userMessage } from "@healthcare/web-session";
import type { Page, PatientSummary } from "@/lib/api/types";
import { label } from "@/lib/patient-mapping";

const PAGE_SIZE = 10;

/**
 * Step one of a task that needs a patient (book an appointment, check in a walk-in) when the page was opened without
 * one: search, then choose. Choosing reopens the same page with `patientId`, keeping the other parameters it came with.
 */
export async function PatientPicker({
  action,
  q,
  keep = {},
  verb,
  canRegister,
}: {
  /** The page to come back to, e.g. "/queue/walk-in". */
  action: string;
  q: string;
  /** Other search parameters to carry through (e.g. practitionerId, date). */
  keep?: Record<string, string | undefined>;
  /** What choosing does, for the row button: "Book", "Check in". */
  verb: string;
  canRegister: boolean;
}) {
  const query = q.trim();
  const kept = Object.fromEntries(Object.entries(keep).filter((e): e is [string, string] => Boolean(e[1])));
  let result: Page<PatientSummary> | undefined;
  let error: string | undefined;
  if (query.length !== 1) {
    try {
      result = await api<Page<PatientSummary>>("/patients", { query: { q: query.length >= 2 ? query : undefined, page: 1, pageSize: PAGE_SIZE } });
    } catch (e) {
      error = e instanceof ApiError && e.status === 403 ? "You don't have permission to search patients." : userMessage(e);
    }
  }
  const choose = (id: string) => `${action}?${new URLSearchParams({ ...kept, patientId: id })}`;

  return (
    <section aria-labelledby="pick-patient" className="m-4 rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 id="pick-patient" className="text-section font-semibold">
          Find the patient
        </h2>
        <p className="text-table text-muted-foreground">Search by name, patient number or mobile number, then choose the patient.</p>
      </div>
      <form role="search" action={action} className="flex flex-wrap items-end gap-2 border-b px-4 py-3">
        {Object.entries(kept).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="grid gap-1">
          <span className="text-meta font-medium text-muted-foreground">Name, patient no. or mobile</span>
          <Input name="q" defaultValue={query} placeholder="e.g. dela cruz juan" className="w-72" autoFocus />
        </label>
        <Button type="submit" size="sm">
          <SearchIcon /> Search
        </Button>
        {canRegister ? (
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link href="/patients/new">
              <UserPlusIcon /> Register a new patient
            </Link>
          </Button>
        ) : null}
      </form>

      {query.length === 1 ? (
        <p className="p-6 text-center text-muted-foreground">Enter at least 2 characters.</p>
      ) : error ? (
        <p role="alert" className="m-4 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-danger-foreground">
          {error}
        </p>
      ) : result && result.items.length === 0 ? (
        <p className="p-6 text-center text-muted-foreground">
          {query ? "No patients match. Check the spelling, or try the patient number or mobile number." : "No patients registered yet."}
        </p>
      ) : result ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Patient no.</TableHead>
                <TableHead>Birth date</TableHead>
                <TableHead>Age / Sex</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Choose</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.displayName}
                    {p.status !== "active" ? (
                      <Badge variant="warning" className="ml-2">
                        {label(p.status)}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono">{p.patientNumber}</TableCell>
                  <TableCell>{clinicalDate(p.birthDate)}</TableCell>
                  <TableCell>
                    {p.age} {sexLabel(p.sex, true)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.primaryMobileMasked ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="xs">
                      <Link href={choose(p.id)} aria-label={`${verb} ${p.displayName}`}>
                        {verb}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {result.hasMore ? (
            <p className="border-t px-4 py-2 text-table text-muted-foreground">
              Showing the first {PAGE_SIZE}. {query ? "Narrow the search to find the patient." : "Search to find a patient further down the list."}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
