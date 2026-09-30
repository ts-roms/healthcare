import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PatientDetail } from "@/lib/api/types";
import { formatAddress, label } from "@/lib/patient-mapping";
import { ApiError } from "@healthcare/web-session";
import {
  AddAddressForm,
  AddContactForm,
  AddIdentifierForm,
  AddRelationshipForm,
  DemographicsForm,
  PreferencesForm,
  RemoveEntry,
  StatusForm,
} from "./edit-forms";

// Never put patient names in the tab title (shoulder surfing, browser history).
export const metadata = { title: "Edit patient details" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Corrections to a patient's record: details, status, contacts, addresses, IDs, emergency contacts and guardians, and
 * communication preferences. Every change is audited by the API; removed entries stay in the record's history.
 */
export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await getSession();
  const canUpdate = can(session, "patient.update");
  const canPreferences = can(session, "patient.consent.manage");
  if (!canUpdate && !canPreferences) redirect(`/patients/${id}`);
  let p: PatientDetail;
  try {
    p = await api<PatientDetail>(`/patients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  // A merged record is read only; its survivor is the one to correct.
  if (p.status === "merged") redirect(p.mergedIntoPatientId ? `/patients/${p.mergedIntoPatientId}/edit` : `/patients/${id}`);

  return (
    <>
      <PageHeader
        title="Edit patient details"
        description={`${p.displayName} · ${p.patientNumber}`}
        actions={
          <Link className="text-table text-primary hover:underline" href={`/patients/${p.id}`}>
            Back to the record
          </Link>
        }
      />
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        {canUpdate ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="text-table">
                <DemographicsForm key={p.version} patientId={p.id} current={p} version={p.version} />
              </CardContent>
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Record status</CardTitle>
                  <Badge variant={p.status === "active" ? "success" : "warning"} className="ml-auto">
                    {label(p.status)}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-table">
                  {p.deceasedAt ? <p>Deceased {clinicalDateTime(p.deceasedAt)}.</p> : null}
                  <p className="text-muted-foreground">
                    Inactive records are left out of patient search (tick “Include inactive records” to find them) and get no optional reminders. Deceased
                    patients are never contacted. A mistaken change is corrected the same way, with a reason.
                  </p>
                  <StatusForm key={`${p.status}-${p.version}`} patientId={p.id} version={p.version} status={p.status} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Phone numbers and email</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-table">
                  <EntryList empty="No contact details recorded.">
                    {p.contacts.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                        <span className="w-16 text-meta text-muted-foreground">{label(c.system)}</span>
                        <span className="tabular">{c.value}</span>
                        <span className="text-meta text-muted-foreground">{label(c.use)}</span>
                        {c.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                        <RemoveEntry patientId={p.id} collection="contacts" recordId={c.id} what="Contact" />
                      </li>
                    ))}
                  </EntryList>
                  <AddContactForm patientId={p.id} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Addresses</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-table">
                <EntryList empty="No address recorded.">
                  {p.addresses.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <span className="w-16 text-meta text-muted-foreground">{label(a.use)}</span>
                      <span>{formatAddress(a)}</span>
                      {a.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                      <RemoveEntry patientId={p.id} collection="addresses" recordId={a.id} what="Address" />
                    </li>
                  ))}
                </EntryList>
                <AddAddressForm patientId={p.id} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>IDs</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-table">
                <EntryList empty="No IDs recorded (PhilHealth PIN, PhilSys, SC/PWD ID, HMO).">
                  {p.identifiers.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <span className="w-36 text-meta text-muted-foreground">{label(i.type)}</span>
                      <span className="font-mono">{i.value}</span>
                      {i.issuer ? <span className="text-meta text-muted-foreground">{i.issuer}</span> : null}
                      {i.validUntil ? <span className="text-meta text-muted-foreground">until {clinicalDate(i.validUntil)}</span> : null}
                      <RemoveEntry patientId={p.id} collection="identifiers" recordId={i.id} what="ID" />
                    </li>
                  ))}
                </EntryList>
                <AddIdentifierForm patientId={p.id} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Emergency contacts, guardians and family</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-table">
                <EntryList empty="None recorded.">
                  {p.relationships.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <span className="font-medium">{r.name ?? "Registered patient"}</span>
                      <span className="text-muted-foreground">{label(r.relationship)}</span>
                      {r.isEmergencyContact ? <Badge variant="info">Emergency contact</Badge> : null}
                      {r.isLegalGuardian ? <Badge>Guardian</Badge> : null}
                      {r.contactNumber ? <span className="tabular">{r.contactNumber}</span> : null}
                      <RemoveEntry patientId={p.id} collection="relationships" recordId={r.id} what="Person" />
                    </li>
                  ))}
                </EntryList>
                <AddRelationshipForm patientId={p.id} />
              </CardContent>
            </Card>
          </>
        ) : null}

        {canPreferences ? (
          <Card>
            <CardHeader>
              <CardTitle>Communication preferences</CardTitle>
            </CardHeader>
            <CardContent className="text-table">
              <PreferencesForm
                key={p.communicationPreferences.map((c) => `${c.channel}:${c.category}:${c.optedIn}`).join()}
                patientId={p.id}
                recorded={p.communicationPreferences}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
      <p className="px-4 pb-4 text-meta text-muted-foreground">
        Every change is recorded in the audit trail with who made it and why. Removed entries are kept in the record&apos;s history, never deleted.
      </p>
    </>
  );
}

function EntryList({ empty, children }: { empty: string; children: React.ReactNode[] }) {
  return children.length ? <ul className="flex flex-col divide-y rounded-md border px-2">{children}</ul> : <p className="text-muted-foreground">{empty}</p>;
}
