import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangleIcon, InfoIcon, SearchIcon, UserIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime, sexLabel } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { FhirImportCandidates, FhirImportDetail, FhirImportEntry, Page, PatientSummary } from "@/lib/api/types";
import { countsText, EntryOutcome, ImportStatus } from "../import-status";
import { EntrySummary, ImportedPatientSummary } from "./entry-summary";
import { EntryActions, MatchButton, RegisterFromImport, RejectImport } from "./review-actions";

export const metadata = { title: "Record import" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BECOMES: Record<NonNullable<FhirImportEntry["becomes"]>, string> = {
  allergy: "Accepting records an allergy (unconfirmed, marked as from an external source).",
  external_history: "Accepting adds it to the patient's external history — not a diagnosis, result, vital sign or prescription.",
  patient_match: "Used to match the patient; the patient's demographics are not changed.",
};
const ACCEPT_LABEL: Record<NonNullable<FhirImportEntry["becomes"]>, string> = {
  allergy: "Accept as allergy",
  external_history: "Accept as external history",
  patient_match: "Accept",
};

/**
 * Review of one FHIR import: match the patient (duplicate-detection candidates, search, or registration with the
 * normal duplicate review), then accept or reject each entry. Viewing is audited by the API.
 */
export default async function ImportReviewPage({ params, searchParams }: { params: Promise<{ importId: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ importId }, { q = "" }, session] = await Promise.all([params, searchParams, getSession()]);
  if (!can(session, "interop.fhir.import.review")) redirect("/");
  if (!UUID.test(importId)) notFound();
  const detail = await api<FhirImportDetail>(`/fhir-imports/${importId}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const pending = detail.status === "pending_review";
  const clinicalAccepted = detail.entries.some((e) => e.outcome === "accepted" && e.kind !== "patient");
  const canMatch = pending && !clinicalAccepted;
  const query = q.trim();
  const [candidates, search] = await Promise.all([
    canMatch && !detail.contentPurged ? api<FhirImportCandidates>(`/fhir-imports/${importId}/candidates`) : Promise.resolve(null),
    canMatch && query.length >= 2 && can(session, "patient.search")
      ? api<Page<PatientSummary>>("/patients", { query: { q: query, pageSize: 10 } }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const reviewable = detail.entries.filter((e) => e.kind !== "patient");

  return (
    <>
      <PageHeader
        title="Record import"
        description={
          <>
            Received {clinicalDateTime(detail.receivedAt)} from {detail.declaredSource ?? "an undeclared source"} · {countsText(detail.resourceCounts)}
          </>
        }
        actions={
          <>
            <ImportStatus status={detail.status} />
            <Button asChild size="sm" variant="outline">
              <Link href="/records/imports">All imports</Link>
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="flex items-start gap-2 text-table text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          This content came from outside the platform and is not in any record. Check that it belongs to the patient you match; accept only what you would
          record yourself. The sender&apos;s source is as declared, not verified.
        </p>
        {detail.contentPurged ? (
          <p role="status" className="rounded-md border px-3 py-2 text-table">
            The received content was deleted by the retention rule for rejected imports; only the decisions remain.
          </p>
        ) : null}
        {detail.rejectionReason ? <p className="text-table">Rejected: {detail.rejectionReason}</p> : null}

        <Card>
          <CardHeader>
            <UserIcon className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Patient</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <section aria-label="Imported patient" className="flex flex-col gap-2">
              <h2 className="text-table font-medium">As sent</h2>
              {detail.importedPatient ? (
                <>
                  <ImportedPatientSummary patient={detail.importedPatient} />
                  {detail.importedPatient.notes.map((n) => (
                    <Note key={n}>{n}</Note>
                  ))}
                </>
              ) : (
                <p className="text-body text-muted-foreground">
                  {detail.contentPurged ? "No longer available." : "The import has no Patient resource: find the patient by search."}
                </p>
              )}
            </section>
            <section aria-label="Matched patient" className="flex flex-col gap-2">
              <h2 className="text-table font-medium">Matched patient</h2>
              {detail.patient ? (
                <div className="flex flex-col gap-1 text-body">
                  <Link href={`/patients/${detail.patient.id}`} className="font-medium text-primary hover:underline">
                    {detail.patient.displayName}
                  </Link>
                  <span className="text-muted-foreground">
                    {detail.patient.patientNumber} · {clinicalDate(detail.patient.birthDate)} · {sexLabel(detail.patient.sex)}
                  </span>
                  {detail.matchedAt ? <span className="text-meta text-muted-foreground">Matched {clinicalDateTime(detail.matchedAt)}</span> : null}
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-body">
                  <AlertTriangleIcon className="size-4 text-warning" aria-hidden /> Not matched yet — entries cannot be accepted until you match the patient.
                </p>
              )}
              {canMatch ? (
                <div className="flex flex-col gap-3 border-t pt-3">
                  {candidates?.candidates.length ? (
                    <div className="flex flex-col gap-1">
                      <h3 className="text-meta font-medium text-muted-foreground">Possible matches (duplicate detection)</h3>
                      <ul className="flex flex-col gap-1.5 text-body">
                        {candidates.candidates.map((c) => (
                          <li key={c.patient.id} className="flex flex-wrap items-center gap-2">
                            <Badge variant={c.level === "certain" ? "success" : c.level === "high" ? "info" : "neutral"}>{c.level}</Badge>
                            <span>
                              {c.patient.displayName} <span className="text-muted-foreground">· {c.patient.patientNumber}</span>
                            </span>
                            <span className="text-meta text-muted-foreground">
                              {clinicalDate(c.patient.birthDate)} · {c.reasons.map((r) => r.replace(/_/g, " ")).join(", ")}
                            </span>
                            {c.patient.id !== detail.patientId ? <MatchButton importId={detail.id} patientId={c.patient.id} version={detail.version} /> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : candidates ? (
                    <p className="text-table text-muted-foreground">
                      {candidates.searchable
                        ? "Duplicate detection found no existing patient."
                        : "Not enough demographics for duplicate detection: search below."}
                    </p>
                  ) : null}
                  {can(session, "patient.search") ? (
                    <form className="flex items-center gap-1.5" action={`/records/imports/${detail.id}`}>
                      <Input name="q" defaultValue={query} placeholder="Search by name or patient number" aria-label="Search patients" className="h-8" />
                      <Button type="submit" size="sm" variant="outline">
                        <SearchIcon /> Search
                      </Button>
                    </form>
                  ) : null}
                  {search ? (
                    search.items.length ? (
                      <ul className="flex flex-col gap-1.5 text-body">
                        {search.items.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2">
                            {p.displayName} <span className="text-muted-foreground">· {p.patientNumber}</span>
                            <span className="text-meta text-muted-foreground">
                              {clinicalDate(p.birthDate)} · {sexLabel(p.sex)}
                            </span>
                            {p.id !== detail.patientId && p.status !== "merged" ? (
                              <MatchButton importId={detail.id} patientId={p.id} version={detail.version} />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-table text-muted-foreground">No patient found.</p>
                    )
                  ) : null}
                  {!detail.patient && detail.registration.possible && can(session, "patient.register") ? (
                    <RegisterFromImport importId={detail.id} version={detail.version} />
                  ) : null}
                </div>
              ) : null}
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Entries</CardTitle>
            {pending ? (
              <div className="ml-auto">
                <RejectImport importId={detail.id} version={detail.version} />
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {reviewable.length === 0 ? <p className="text-body text-muted-foreground">Nothing but the Patient resource was sent.</p> : null}
            {reviewable.map((e) => (
              <article key={e.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]" aria-label={`Entry ${e.index + 1}: ${e.resourceType}`}>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-meta text-muted-foreground">#{e.index + 1}</span>
                    <span className="text-table font-medium">{e.resourceType}</span>
                    <EntryOutcome outcome={e.outcome} />
                    {e.decidedAt ? <span className="text-meta text-muted-foreground">{clinicalDateTime(e.decidedAt)}</span> : null}
                  </div>
                  {e.item ? <EntrySummary item={e.item} /> : <p className="text-table text-muted-foreground">Content no longer available.</p>}
                  {e.item?.notes.map((n) => (
                    <Note key={n}>{n}</Note>
                  ))}
                  {e.outcome === "pending" && e.becomes ? <p className="text-meta text-muted-foreground">{BECOMES[e.becomes]}</p> : null}
                  {e.reason ? <p className="text-table">Rejected: {e.reason}</p> : null}
                  {e.outcome === "accepted" && detail.patient ? (
                    <p className="text-table">
                      Recorded {e.resultType === "allergy_intolerance" ? "as an allergy" : "in external history"} for{" "}
                      <Link href={`/patients/${detail.patient.id}`} className="text-primary hover:underline">
                        {detail.patient.displayName}
                      </Link>
                      .
                    </p>
                  ) : null}
                </div>
                {pending && e.outcome === "pending" && e.becomes ? (
                  <EntryActions
                    importId={detail.id}
                    entryId={e.id}
                    canAccept={Boolean(detail.patient) && Boolean(e.item?.acceptable)}
                    acceptHint={!detail.patient ? "Match the patient first." : e.item && !e.item.acceptable ? "Cannot be accepted (see above)." : null}
                    acceptLabel={ACCEPT_LABEL[e.becomes]}
                  />
                ) : null}
              </article>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-table text-warning-foreground">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}
