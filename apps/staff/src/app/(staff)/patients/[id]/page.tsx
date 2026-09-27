import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CalendarIcon,
  CalendarPlusIcon,
  LogInIcon,
  EyeOffIcon,
  PhoneIcon,
  PillIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UsersIcon,
} from "lucide-react";
import { AllergyBadge, clinicalDate, clinicalDateTime, PatientHeader, sexLabel, SummarySection, VitalSigns } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { api } from "@/lib/api/client";
import { ApiError } from "@healthcare/web-session";
import { can, getSession } from "@/lib/api/session";
import type { PatientDetail, PatientSummaryResponse, PortalAccountStatus } from "@/lib/api/types";
import { PortalAccess } from "./portal-access";
import { bannerSeverity, currentConsents, formatAddress, label, sortByDanger, toBannerPatient, toVitalSigns } from "@/lib/patient-mapping";

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

/** Clinical snapshot (allergies, problems, meds, vitals, visits, care plans), only for users with clinical access. */
async function loadSummary(id: string): Promise<PatientSummaryResponse | null> {
  const session = await getSession();
  if (!can(session, "patient.read") || !can(session, "clinical.read")) return null;
  try {
    return await api<PatientSummaryResponse>(`/patients/${id}/summary`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

/** Patient portal account status; null when it cannot be shown (the rest of the record still renders). */
async function loadPortalAccount(id: string): Promise<PortalAccountStatus | null> {
  try {
    return await api<PortalAccountStatus>(`/patients/${id}/portal-account`);
  } catch (e) {
    if (e instanceof ApiError) return null;
    throw e;
  }
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, summary, portal, session] = await Promise.all([loadPatient(id), loadSummary(id), loadPortalAccount(id), getSession()]);
  const canCheckIn = can(session, "clinic.queue.manage");
  const canBook = can(session, "appointment.manage");
  const consents = currentConsents(p.consents);
  const emergency = p.relationships.filter((r) => r.isEmergencyContact || r.isLegalGuardian);

  return (
    <div className="flex min-h-full flex-col">
      <PatientHeader
        patient={toBannerPatient(p, summary?.allergies)}
        allergiesHidden={!summary}
        allergiesRecorded={summary ? summary.allergies.status !== "not_reviewed" : true}
      />
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

      {p.status === "active" && (canCheckIn || canBook) ? (
        <div className="flex flex-wrap gap-2 border-b bg-card px-4 py-2">
          {canCheckIn ? (
            <Button asChild size="sm">
              <Link href={`/queue/walk-in?patientId=${p.id}`}>
                <LogInIcon /> Check in (walk-in)
              </Link>
            </Button>
          ) : null}
          {canBook ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/appointments/new?patientId=${p.id}`}>
                <CalendarPlusIcon /> Book appointment
              </Link>
            </Button>
          ) : null}
        </div>
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

        <Card className="lg:row-span-3">
          <CardHeader>
            <ActivityIcon className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Clinical summary</CardTitle>
          </CardHeader>
          <CardContent>{summary ? <ClinicalPanel summary={summary} /> : <NoClinicalAccess />}</CardContent>
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

        <Card className="lg:col-span-2">
          <CardHeader>
            <SmartphoneIcon className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Patient portal (MyHealth)</CardTitle>
          </CardHeader>
          <CardContent>
            {portal ? (
              <PortalAccess
                patientId={p.id}
                patientNumber={p.patientNumber}
                account={portal}
                canManage={can(session, "patient.portal.manage")}
                patientActive={p.status === "active"}
              />
            ) : (
              <p className="text-body text-muted-foreground">Portal status is unavailable right now.</p>
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

function NoClinicalAccess() {
  return (
    <div className="flex flex-col gap-1.5 text-body text-muted-foreground">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <EyeOffIcon className="size-4" aria-hidden /> No access to clinical information
      </p>
      <p>Allergies, problems, medications and visits are shown to clinical staff. Ask a nurse or physician before any clinical decision.</p>
    </div>
  );
}

function ClinicalPanel({ summary }: { summary: PatientSummaryResponse }) {
  const { allergies } = summary;
  const vitals = summary.latestVitals[0];
  return (
    <div className="flex flex-col gap-4">
      <SummarySection title="Allergies" icon={ShieldAlertIcon}>
        {allergies.status === "has_allergies" ? (
          <ul className="flex flex-col gap-1.5">
            {sortByDanger(allergies.allergies.map((a) => ({ ...a, severity: bannerSeverity(a), recorded: a }))).map(({ recorded: a }) => (
              <li key={a.id} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <AllergyBadge allergy={{ id: a.id, substance: a.substance, severity: bannerSeverity(a) }} />
                  <span className="text-meta text-muted-foreground">
                    {label(a.category)} · {a.severity ? label(a.severity) : "severity not recorded"}
                    {a.criticality === "high" ? " · high criticality" : ""}
                  </span>
                  {a.verification === "unconfirmed" ? <Badge variant="warning">Unconfirmed</Badge> : null}
                </span>
                {a.reaction ? <span className="text-table text-muted-foreground">{a.reaction}</span> : null}
              </li>
            ))}
          </ul>
        ) : allergies.status === "no_known_allergies" ? (
          <Badge variant="success">
            <ShieldCheckIcon aria-hidden /> No known allergies
          </Badge>
        ) : (
          <Badge variant="warning">
            <AlertTriangleIcon aria-hidden /> Allergies not recorded — ask the patient
          </Badge>
        )}
        {allergies.lastReviewedAt ? <p className="text-meta text-muted-foreground">Last reviewed {clinicalDateTime(allergies.lastReviewedAt)}</p> : null}
      </SummarySection>

      <SummarySection title="Problems" icon={ActivityIcon}>
        {summary.problemList.length ? (
          <ul className="flex flex-col gap-1">
            {summary.problemList.map((d) => (
              <li key={d.id} className="flex items-baseline gap-2 text-body">
                <span className="w-14 shrink-0 font-mono text-meta text-muted-foreground">{d.code}</span>
                <span>{d.display}</span>
                {d.isChronic ? <Badge>Chronic</Badge> : null}
                {d.certainty === "provisional" ? <Badge variant="outline">Provisional</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-table text-muted-foreground">No active problems recorded.</p>
        )}
      </SummarySection>

      {summary.activePrescriptions ? (
        <SummarySection title="Active prescriptions" icon={PillIcon}>
          {summary.activePrescriptions.length ? (
            <ul className="flex flex-col gap-1">
              {summary.activePrescriptions.flatMap((rx) =>
                rx.items.map((i) => (
                  <li key={i.id} className="text-body">
                    <span className="font-medium">{i.genericName}</span>
                    {i.strength ? ` ${i.strength}` : ""} <span className="text-muted-foreground">· {i.instructions}</span>
                  </li>
                )),
              )}
            </ul>
          ) : (
            <p className="text-table text-muted-foreground">No active prescriptions.</p>
          )}
        </SummarySection>
      ) : null}

      <SummarySection title="Latest vitals">
        {vitals ? <VitalSigns vitals={toVitalSigns(vitals)} /> : <p className="text-table text-muted-foreground">No vital signs recorded.</p>}
      </SummarySection>

      <SummarySection title="Upcoming visits" icon={CalendarIcon}>
        {summary.upcomingAppointments.length ? (
          <ul className="flex flex-col gap-1 text-body">
            {summary.upcomingAppointments.map((a) => (
              <li key={a.id}>
                <span className="tabular">{clinicalDateTime(a.startsAt)}</span>
                {a.reason ? <span className="text-muted-foreground"> · {a.reason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-table text-muted-foreground">None booked.</p>
        )}
      </SummarySection>

      {summary.openCarePlans?.length ? (
        <SummarySection title="Care plans">
          <ul className="flex flex-col gap-1 text-body">
            {summary.openCarePlans.map((c) => (
              <li key={c.id}>
                {c.title} <span className="text-muted-foreground">· {c.openActivities.length} open activities</span>
              </li>
            ))}
          </ul>
        </SummarySection>
      ) : null}
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
