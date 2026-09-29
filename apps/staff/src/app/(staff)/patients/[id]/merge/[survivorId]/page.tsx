import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, BanIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime, sexLabel } from "@healthcare/ui/healthcare";
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
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { MergePreview, MergeRecordView, MergeWorkItem } from "@/lib/api/types";
import { label } from "@/lib/patient-mapping";
import { MERGE_WORK_ACTIONS, MERGE_WORK_LABELS, mergeWorkHref, PORTAL_HANDLING_TEXT } from "@/lib/patient-merge";
import { MergeForm } from "./merge-form";

// Never put patient names in the tab title.
export const metadata = { title: "Compare and merge" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Merging a duplicate, step 2: both records side by side, the differences to acknowledge and the work in progress
 * under the record to retire (each linked, to finish, cancel or rebook first). Viewing the comparison is audited.
 */
export default async function MergeComparePage({ params }: { params: Promise<{ id: string; survivorId: string }> }) {
  const [{ id, survivorId }, session] = await Promise.all([params, getSession()]);
  if (!UUID.test(id) || !UUID.test(survivorId) || !can(session, "patient.merge")) notFound();
  const preview = await api<MergePreview>(`/patients/${id}/merge-preview`, { query: { into: survivorId } }).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const { retired, survivor } = preview;
  const flagged = new Set(preview.differences.map((d) => d.code));

  return (
    <>
      <PageHeader
        title="Compare and merge"
        description={
          <>
            Retire <span className="font-mono">{retired.patientNumber}</span> into <span className="font-mono">{survivor.patientNumber}</span>
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/patients/${survivor.id}/merge`}>
              <ArrowLeftIcon aria-hidden /> Choose again
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        {preview.ineligibility ? (
          <p role="alert" className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-danger-foreground">
            <BanIcon className="size-4" aria-hidden /> {preview.ineligibility.message}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>The two records</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44" />
                  <TableHead>
                    To retire · <span className="font-mono">{retired.patientNumber}</span>
                  </TableHead>
                  <TableHead>
                    Survives · <span className="font-mono">{survivor.patientNumber}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <CompareRow
                  term="Name"
                  flagged={["family_name", "given_name", "middle_name", "suffix"].some((c) => flagged.has(c))}
                  values={[retired, survivor].map((r) => r.displayName)}
                />
                <CompareRow
                  term="Birth date"
                  flagged={flagged.has("birth_date")}
                  values={[retired, survivor].map((r) => `${clinicalDate(r.birthDate)} (${r.age} y)`)}
                />
                <CompareRow term="Sex" flagged={flagged.has("sex")} values={[retired, survivor].map((r) => sexLabel(r.sex))} />
                <CompareRow
                  term="Status"
                  flagged={flagged.has("deceased_status")}
                  values={[retired, survivor].map((r) => `${label(r.status)}${r.deceasedAt ? ` (${clinicalDate(r.deceasedAt)})` : ""}`)}
                />
                <CompareRow term="Identifiers" flagged={[...flagged].some((c) => c.startsWith("identifier:"))} values={[retired, survivor].map(identifiers)} />
                <CompareRow term="Contacts" values={[retired, survivor].map((r) => r.contacts.map((c) => `${label(c.system)} ${c.value}`).join(", ") || "—")} />
                <CompareRow term="MyHealth account" values={[retired, survivor].map((r) => (r.portalAccount ? label(r.portalAccount.status) : "None"))} />
                <CompareRow term="Consent" values={[retired, survivor].map(consents)} />
                <CompareRow term="Registered" values={[retired, survivor].map((r) => clinicalDateTime(r.createdAt))} />
                <CompareRow
                  term="Already merged into it"
                  values={[retired, survivor].map((r) => r.mergedRecords.map((m) => m.patientNumber).join(", ") || "—")}
                />
              </TableBody>
            </Table>
            <p className="mt-2 text-meta text-muted-foreground">
              Identifiers, contacts, addresses, relationships and consent stay on the retired record as history; the surviving record&apos;s consent and
              communication preferences govern from now on.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            {preview.blockers.length ? (
              <AlertTriangleIcon className="size-4 text-warning-foreground" aria-hidden />
            ) : (
              <CheckCircle2Icon className="size-4" aria-hidden />
            )}
            <CardTitle>Work in progress under {retired.patientNumber}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {preview.blockers.length ? (
              <>
                <p className="text-body">
                  Finish, cancel or rebook these first: after the merge nothing new can be filed under the retired number and no reminders are sent to it.
                </p>
                <WorkList items={preview.blockers} retiredId={retired.id} />
              </>
            ) : (
              <p className="text-body text-muted-foreground">Nothing in progress blocks this merge.</p>
            )}
            {preview.warnings.length ? (
              <div className="flex flex-col gap-1">
                <p className="flex items-center gap-1.5 text-table font-medium">
                  <InfoIcon className="size-4" aria-hidden /> Also note
                </p>
                <WorkList items={preview.warnings} retiredId={retired.id} />
              </div>
            ) : null}
            <p className="text-table text-muted-foreground">{PORTAL_HANDLING_TEXT[preview.portalAccount]}</p>
            {preview.repointed.length ? (
              <p className="text-table text-muted-foreground">
                Records already merged into {retired.patientNumber} ({preview.repointed.map((r) => r.patientNumber).join(", ")}) will point to{" "}
                {survivor.patientNumber} as well.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {preview.canMerge ? (
          <MergeForm
            retiredPatientId={retired.id}
            retiredNumber={retired.patientNumber}
            survivorPatientId={survivor.id}
            survivorNumber={survivor.patientNumber}
            retiredVersion={retired.version}
            survivorVersion={survivor.version}
            differences={preview.differences}
          />
        ) : !preview.ineligibility ? (
          <p className="text-body text-muted-foreground">Resolve the work in progress above, then reload this page to merge.</p>
        ) : null}
      </div>
    </>
  );
}

function identifiers(r: MergeRecordView): string {
  return r.identifiers.map((i) => `${label(i.type)}${i.issuer ? ` (${i.issuer})` : ""}: ${i.value}`).join(", ") || "—";
}

function consents(r: MergeRecordView): string {
  return r.consents.map((c) => `${label(c.consentType)}: ${label(c.decision)}`).join(", ") || "None recorded";
}

function CompareRow({ term, values, flagged = false }: { term: string; values: string[]; flagged?: boolean }) {
  return (
    <TableRow>
      <TableCell className="align-top text-muted-foreground">
        {term}
        {flagged ? (
          <Badge variant="warning" className="ml-1.5">
            <AlertTriangleIcon aria-hidden /> Differs
          </Badge>
        ) : null}
      </TableCell>
      {values.map((v, i) => (
        <TableCell key={i} className="align-top">
          {v}
        </TableCell>
      ))}
    </TableRow>
  );
}

function WorkList({ items, retiredId }: { items: MergeWorkItem[]; retiredId: string }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const href = mergeWorkHref(item, retiredId);
        return (
          <li key={`${item.kind}:${item.id}`} className="flex flex-col gap-0.5 text-body">
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{MERGE_WORK_LABELS[item.kind]}</Badge>
              {href ? (
                <Link href={href} className="text-primary hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span>{item.label}</span>
              )}
              {item.at ? <span className="tabular text-meta text-muted-foreground">{clinicalDateTime(item.at)}</span> : null}
            </span>
            <span className="text-meta text-muted-foreground">{MERGE_WORK_ACTIONS[item.kind]}</span>
          </li>
        );
      })}
    </ul>
  );
}
