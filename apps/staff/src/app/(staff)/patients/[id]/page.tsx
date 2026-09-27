import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangleIcon, ClipboardXIcon, PhoneIcon, ShieldCheckIcon, UsersIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime, PatientHeader, sexLabel } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { PatientDetail } from "@/lib/api/types";
import { currentConsents, formatAddress, label, toBannerPatient } from "@/lib/patient-mapping";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadPatient(id: string): Promise<PatientDetail> {
  if (!UUID.test(id)) notFound();
  try {
    return await api<PatientDetail>(`/patients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}

// Never put patient names in the tab title (shoulder surfing, browser history).
export const metadata = { title: "Patient record" };

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await loadPatient((await params).id);
  const consents = currentConsents(p.consents);
  const emergency = p.relationships.filter((r) => r.isEmergencyContact || r.isLegalGuardian);

  return (
    <div className="flex min-h-full flex-col">
      <PatientHeader patient={toBannerPatient(p)} allergiesRecorded={false} />
      {p.status !== "active" ? (
        <p
          role="alert"
          className="flex items-center gap-2 border-b border-warning/40 bg-warning-subtle px-4 py-2 text-table font-medium text-warning-foreground"
        >
          <AlertTriangleIcon className="size-4" aria-hidden />
          Record status: {label(p.status)}
          {p.deceasedAt ? ` — deceased ${clinicalDate(p.deceasedAt)}` : ""}
          {p.mergedIntoPatientId ? (
            <Link href={`/patients/${p.mergedIntoPatientId}`} className="underline">
              Open the surviving record
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Demographics</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-body">
              <Row term="Name">{p.displayName}</Row>
              <Row term="Birth date">
                {clinicalDate(p.birthDate)}
                {p.birthDateIsEstimated ? <Badge className="ml-2">Estimated</Badge> : null} <span className="text-muted-foreground">({p.age} y)</span>
              </Row>
              <Row term="Sex">{sexLabel(p.sex)}</Row>
              {p.genderIdentity ? <Row term="Gender identity">{p.genderIdentity}</Row> : null}
              <Row term="Civil status">{label(p.civilStatus)}</Row>
              <Row term="Nationality">{p.nationality ?? "—"}</Row>
              <Row term="Occupation">{p.occupation ?? "—"}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <PhoneIcon className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Contact &amp; address</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-body">
            {p.contacts.length ? (
              <ul className="flex flex-col gap-1">
                {p.contacts.map((c) => (
                  <li key={c.id} className="flex items-baseline gap-2">
                    <span className="w-16 text-meta text-muted-foreground">{label(c.system)}</span>
                    <span className="tabular">{c.value}</span>
                    {c.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No contact details recorded.</p>
            )}
            {p.addresses.length ? (
              <ul className="flex flex-col gap-1 border-t pt-2">
                {p.addresses.map((a) => (
                  <li key={a.id} className="flex items-baseline gap-2">
                    <span className="w-16 text-meta text-muted-foreground">{label(a.use)}</span>
                    <span>{formatAddress(a)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t pt-2 text-muted-foreground">No address recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:row-span-2">
          <CardHeader>
            <ClipboardXIcon className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Clinical record</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-body">
            <p className="font-medium">Not available yet.</p>
            <p className="text-muted-foreground">
              Allergies, medications, problems, encounters and results are recorded in the clinical modules (Phase 2). Until then, confirm allergies with the
              patient before prescribing.
            </p>
            <Link href="/preview/patient-360" className="text-table text-primary hover:underline">
              See the Patient 360 design preview (sample patient)
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Identifiers</CardTitle>
          </CardHeader>
          <CardContent>
            {p.identifiers.length ? (
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-body">
                {p.identifiers.map((i) => (
                  <Row key={i.id} term={label(i.type)}>
                    <span className="font-mono">{i.value}</span>
                    {i.validUntil ? <span className="ml-2 text-meta text-muted-foreground">until {clinicalDate(i.validUntil)}</span> : null}
                  </Row>
                ))}
              </dl>
            ) : (
              <p className="text-body text-muted-foreground">No identifiers recorded (PhilHealth PIN, PhilSys, SC/PWD ID, HMO).</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <UsersIcon className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Emergency contacts &amp; guardians</CardTitle>
          </CardHeader>
          <CardContent>
            {emergency.length ? (
              <ul className="flex flex-col gap-1.5 text-body">
                {emergency.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.name ?? "Registered patient"}</span>{" "}
                    <span className="text-muted-foreground">· {label(r.relationship)}</span>
                    {r.isLegalGuardian ? <Badge className="ml-2">Guardian</Badge> : null}
                    {r.contactNumber ? <span className="tabular ml-2">{r.contactNumber}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">None recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <ShieldCheckIcon className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Consent &amp; communication</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {consents.length ? (
              <ul className="flex flex-col gap-1 text-body">
                {consents.map((c) => (
                  <li key={c.id} className="flex items-baseline gap-2">
                    <Badge variant={c.decision === "granted" ? "success" : "warning"}>{label(c.decision)}</Badge>
                    <span>{label(c.consentType)}</span>
                    <span className="text-meta text-muted-foreground">{clinicalDate(c.effectiveAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No consent recorded.</p>
            )}
            {p.communicationPreferences.length ? (
              <ul className="flex flex-col gap-1 text-body">
                {p.communicationPreferences.map((c) => (
                  <li key={`${c.channel}-${c.category}`}>
                    {label(c.channel)} · {label(c.category)}:{" "}
                    <span className={c.optedIn ? "" : "text-muted-foreground"}>{c.optedIn ? "Opted in" : "Opted out"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No communication preferences recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="px-4 pb-4 text-meta text-muted-foreground">
        Registered {clinicalDateTime(p.createdAt)} · last updated {clinicalDateTime(p.updatedAt)} · version {p.version}. Viewing this record is recorded in the
        audit trail.
      </p>
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </>
  );
}
