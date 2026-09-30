import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlertIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { AuditEventRow, Page, StaffUser } from "@/lib/api/types";
import { auditApiQuery, auditPageHref, readAuditFilters } from "@/lib/audit-filters";
import { organizationDirectory } from "../users/directory";

export const metadata = { title: "Audit log" };

function Outcome({ outcome }: { outcome: string }) {
  if (outcome === "success")
    return (
      <Badge variant="success">
        <CircleCheckIcon aria-hidden /> Success
      </Badge>
    );
  if (outcome === "denied")
    return (
      <Badge variant="danger">
        <CircleXIcon aria-hidden /> Denied
      </Badge>
    );
  return (
    <Badge variant="warning">
      <CircleAlertIcon aria-hidden /> {outcome === "failure" ? "Failed" : outcome}
    </Badge>
  );
}

/**
 * The organization's audit trail, newest first: who did what, when, to which record. Reading it is itself audited
 * (one `audit.search` event per search).
 */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "audit.read")) redirect("/");
  const filters = readAuditFilters(params);
  const [page, users, directory] = await Promise.all([
    api<Page<AuditEventRow>>("/audit-events", { query: auditApiQuery(filters) }),
    can(session, "user.read") ? api<StaffUser[]>("/users") : Promise.resolve([] as StaffUser[]),
    organizationDirectory(session),
  ]);
  const userName = (id: string | null) => (id ? (users.find((u) => u.id === id)?.displayName ?? "A staff member") : null);
  const facilityName = (id: string | null) => (id ? (directory.facilities.find((f) => f.id === id)?.name ?? null) : null);
  return (
    <>
      <PageHeader title="Audit log" description="Who did what, when and to which record. Each search you make here is recorded too." />
      <div className="flex flex-col gap-4 p-4">
        <form method="get" className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="grid gap-1">
            <Label htmlFor="audit-from">From (day)</Label>
            <Input id="audit-from" name="from" type="date" defaultValue={filters.from} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="audit-to">To (day)</Label>
            <Input id="audit-to" name="to" type="date" defaultValue={filters.to} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="audit-action">Action</Label>
            <Input id="audit-action" name="action" placeholder="e.g. patient.read" defaultValue={filters.action} maxLength={128} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="audit-resource">Record type</Label>
            <Input id="audit-resource" name="resourceType" placeholder="e.g. patient" defaultValue={filters.resourceType} maxLength={64} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="audit-actor">Staff member</Label>
            {users.length > 0 ? (
              <NativeSelect emptyText="No staff users" id="audit-actor" name="actor" defaultValue={filters.actor}>
                <option value="">Anyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input id="audit-actor" name="actor" placeholder="User id" defaultValue={filters.actor} />
            )}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="audit-patient">Patient id</Label>
            <Input id="audit-patient" name="patient" placeholder="From the patient record's address" defaultValue={filters.patient} />
          </div>
          <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
            <Button type="submit" size="sm">
              Search
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/audit">Clear</Link>
            </Button>
          </div>
        </form>

        {page.items.length === 0 ? (
          <p className="text-table text-muted-foreground">Nothing matches.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap">
                    {clinicalDateTime(event.occurredAt)}
                    {facilityName(event.facilityId) ? <span className="block text-meta text-muted-foreground">{facilityName(event.facilityId)}</span> : null}
                  </TableCell>
                  <TableCell>
                    {event.actorType === "user" ? (
                      (userName(event.actorUserId) ?? "Staff")
                    ) : event.actorType === "patient" ? (
                      "Patient (MyHealth)"
                    ) : event.actorType === "anonymous" ? (
                      <span className="text-muted-foreground">Not signed in</span>
                    ) : (
                      <span className="text-muted-foreground">System</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code>{event.action}</code>
                    {event.reason ? <span className="block max-w-64 text-meta whitespace-normal text-muted-foreground">Reason: {event.reason}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    <span>{event.resourceType}</span>
                    {event.patientId ? (
                      <Link className="block text-meta text-primary hover:underline" href={`/patients/${event.patientId}`}>
                        Open patient
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Outcome outcome={event.outcome} />
                  </TableCell>
                  <TableCell className="max-w-96 whitespace-normal">
                    {event.changes || event.metadata || event.resourceId || event.ipAddress ? (
                      <details>
                        <summary className="cursor-pointer text-meta text-primary">Show</summary>
                        <dl className="mt-1 grid gap-1 text-meta">
                          {event.resourceId ? (
                            <div>
                              <dt className="text-muted-foreground">Record id</dt>
                              <dd className="font-mono break-all">{event.resourceId}</dd>
                            </div>
                          ) : null}
                          {event.changes ? (
                            <div>
                              <dt className="text-muted-foreground">Changes</dt>
                              <dd>
                                <pre className="overflow-auto rounded bg-muted/60 p-1">{JSON.stringify(event.changes, null, 1)}</pre>
                              </dd>
                            </div>
                          ) : null}
                          {event.metadata ? (
                            <div>
                              <dt className="text-muted-foreground">Details</dt>
                              <dd>
                                <pre className="overflow-auto rounded bg-muted/60 p-1">{JSON.stringify(event.metadata, null, 1)}</pre>
                              </dd>
                            </div>
                          ) : null}
                          {event.ipAddress ? (
                            <div>
                              <dt className="text-muted-foreground">From</dt>
                              <dd className="break-all">
                                {event.ipAddress}
                                {event.userAgent ? ` · ${event.userAgent}` : null}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </details>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <nav aria-label="Pages" className="flex items-center gap-2 text-table">
          {filters.page > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={auditPageHref(filters, filters.page - 1)}>Newer</Link>
            </Button>
          ) : null}
          <span className="text-muted-foreground">Page {filters.page}</span>
          {page.hasMore ? (
            <Button asChild size="sm" variant="outline">
              <Link href={auditPageHref(filters, filters.page + 1)}>Older</Link>
            </Button>
          ) : null}
        </nav>
      </div>
    </>
  );
}
