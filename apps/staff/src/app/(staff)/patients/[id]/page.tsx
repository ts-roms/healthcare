import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArchiveIcon,
  BadgeCheckIcon,
  CalendarIcon,
  CalendarPlusIcon,
  FlaskConicalIcon,
  LogInIcon,
  EyeOffIcon,
  FileInputIcon,
  PhoneIcon,
  PillIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UsersIcon,
  ReceiptIcon,
  SmileIcon,
  HistoryIcon,
  LayoutDashboardIcon,
} from "lucide-react";
import { clinicalDate, clinicalDateTime, PatientHeader, sexLabel, SummarySection, VitalSigns } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { AllergiesPanel } from "@/components/allergies-panel";
import { api } from "@/lib/api/client";
import { ApiError } from "@healthcare/web-session";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type {
  EligibilityOverview,
  ExternalHistoryEntry,
  LabReportArchiveEntry,
  PatientDetail,
  PatientLabResult,
  PatientSummaryResponse,
  PatientTimelinePage,
  PortalAccountStatus,
  YakapConsultationList,
  YakapRegistrationOverview,
} from "@/lib/api/types";
import { todayIn } from "@/lib/clinic-mapping";
import { ConsentHistory } from "./consent-history";
import { ArchivedLabReports } from "./archived-lab-reports";
import { ExternalHistory } from "./external-history";
import { PatientLabResults } from "./lab-results";
import { PhilHealthEligibility } from "./philhealth-eligibility";
import { PhilHealthYakap } from "./philhealth-yakap";
import { ConsentList } from "./consent-list";
import { PortalAccess } from "./portal-access";
import { SendPortalMessage } from "./send-portal-message";
import { RecordConsent } from "./record-consent";
import { formatAddress, label, toBannerPatient, toVitalSigns } from "@/lib/patient-mapping";
import { PatientTimelineView, WithheldNote } from "@/components/patient-timeline-view";

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

/** Released laboratory results (audited by the API); null without laboratory result access. */
async function loadLabResults(id: string): Promise<PatientLabResult[] | null> {
  const session = await getSession();
  if (!can(session, "lab.result.read")) return null;
  try {
    return await api<PatientLabResult[]>(`/laboratory/patients/${id}/results`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

/** Archived copies of released laboratory reports (audited by the API); null without access. */
async function loadArchivedLabReports(id: string): Promise<LabReportArchiveEntry[] | null> {
  const session = await getSession();
  if (!can(session, "lab.result.read") || !can(session, "lab.order.read")) return null;
  try {
    return await api<LabReportArchiveEntry[]>(`/laboratory/patients/${id}/report-archive`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

/** History other providers recorded, accepted from FHIR imports (audited by the API); null without clinical access. */
async function loadExternalHistory(id: string): Promise<ExternalHistoryEntry[] | null> {
  const session = await getSession();
  if (!can(session, "clinical.read")) return null;
  try {
    return await api<ExternalHistoryEntry[]>(`/patients/${id}/external-history`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

/** The latest few timeline entries the user may see (audited by the API); null when they cannot be shown. */
async function loadRecentActivity(id: string): Promise<PatientTimelinePage | null> {
  try {
    return await api<PatientTimelinePage>(`/patients/${id}/timeline`, { query: { limit: 5 } });
  } catch (e) {
    if (e instanceof ApiError) return null;
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

/** PhilHealth eligibility checks (audited by the API); null without the permission. */
async function loadEligibility(id: string): Promise<EligibilityOverview | null> {
  const session = await getSession();
  if (!can(session, "philhealth.eligibility.manage")) return null;
  try {
    return await api<EligibilityOverview>("/philhealth/eligibility", { query: { patientId: id } });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

/** PhilHealth YAKAP registration answers and the patient's consultations (each audited by the API); each part null without its permission. */
async function loadYakap(id: string): Promise<{ overview: YakapRegistrationOverview | null; consultations: YakapConsultationList | null } | null> {
  const session = await getSession();
  const tolerate = <T,>(call: () => Promise<T>) =>
    call().catch((e: unknown) => {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
      throw e;
    });
  const [overview, consultations] = await Promise.all([
    can(session, "philhealth.eligibility.manage")
      ? tolerate(() => api<YakapRegistrationOverview>("/philhealth/yakap/registrations", { query: { patientId: id } }))
      : Promise.resolve(null),
    can(session, "philhealth.claim.submit")
      ? tolerate(() => api<YakapConsultationList>(`/philhealth/yakap/patients/${id}/consultations`))
      : Promise.resolve(null),
  ]);
  return overview || consultations ? { overview, consultations } : null;
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, summary, portal, labResults, labArchives, eligibility, yakap, externalHistory, recent, facility, session] = await Promise.all([
    loadPatient(id),
    loadSummary(id),
    loadPortalAccount(id),
    loadLabResults(id),
    loadArchivedLabReports(id),
    loadEligibility(id),
    loadYakap(id),
    loadExternalHistory(id),
    loadRecentActivity(id),
    getSelectedFacility(),
    getSession(),
  ]);
  const canCheckIn = can(session, "clinic.queue.manage");
  const canBill = can(session, "billing.charge.read");
  const canDental = can(session, "dental.record.read");
  const canBook = can(session, "appointment.manage");
  const canRecordConsent = can(session, "patient.consent.manage") && p.status !== "merged";
  const canViewDocuments = can(session, "document.read");
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

      <div className="flex flex-wrap gap-2 border-b bg-card px-4 py-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`/patients/${p.id}/360`}>
            <LayoutDashboardIcon /> Patient 360
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/patients/${p.id}/timeline`}>
            <HistoryIcon /> Timeline
          </Link>
        </Button>
        {canCheckIn && p.status === "active" ? (
          <Button asChild size="sm">
            <Link href={`/queue/walk-in?patientId=${p.id}`}>
              <LogInIcon /> Check in (walk-in)
            </Link>
          </Button>
        ) : null}
        {canBook && p.status === "active" ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/appointments/new?patientId=${p.id}`}>
              <CalendarPlusIcon /> Book appointment
            </Link>
          </Button>
        ) : null}
        {canBill ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/billing/patients/${p.id}`}>
              <ReceiptIcon /> Billing
            </Link>
          </Button>
        ) : null}
        {canDental ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/dental/patients/${p.id}`}>
              <SmileIcon /> Dental record
            </Link>
          </Button>
        ) : null}
      </div>

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
          <CardContent>
            {summary ? (
              <ClinicalPanel
                summary={summary}
                patientId={p.id}
                canOpenEncounters={can(session, "encounter.read")}
                canOpenCarePlans={can(session, "care-plan.read")}
                canManageAllergies={can(session, "allergy.manage")}
              />
            ) : (
              <NoClinicalAccess />
            )}
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

        {eligibility ? (
          <Card>
            <CardHeader>
              <BadgeCheckIcon className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>PhilHealth eligibility</CardTitle>
            </CardHeader>
            <CardContent>
              <PhilHealthEligibility
                patientId={p.id}
                overview={eligibility}
                today={todayIn(facility?.timezone ?? "Asia/Manila")}
                facilitySelected={facility !== null}
              />
            </CardContent>
          </Card>
        ) : null}

        {yakap ? (
          <Card>
            <CardHeader>
              <BadgeCheckIcon className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>PhilHealth YAKAP</CardTitle>
            </CardHeader>
            <CardContent>
              <PhilHealthYakap patientId={p.id} overview={yakap.overview} consultations={yakap.consultations} facilityId={facility?.id ?? null} />
            </CardContent>
          </Card>
        ) : null}

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
            <div className="flex flex-col gap-3">
              <ConsentList consents={p.consents} canViewDocuments={canViewDocuments} />
              {canRecordConsent ? <RecordConsent patientId={p.id} canUpload={can(session, "document.upload")} /> : null}
              {/* Reset (hide) a stale history when a new decision is recorded. */}
              {p.consents.length ? <ConsentHistory key={p.consents.map((c) => c.id).join()} patientId={p.id} canViewDocuments={canViewDocuments} /> : null}
            </div>
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

        {recent ? (
          <Card className="lg:col-span-2" id="recent-activity">
            <CardHeader>
              <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>Recent activity</CardTitle>
              <Button asChild size="sm" variant="ghost" className="ml-auto">
                <Link href={`/patients/${p.id}/timeline`}>Open timeline</Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {recent.items.length ? (
                <PatientTimelineView entries={recent.items} patientId={p.id} timeZone={recent.timeZone} />
              ) : recent.withheld.length ? null : (
                <p className="text-body text-muted-foreground">Nothing recorded yet.</p>
              )}
              <WithheldNote withheld={recent.withheld} />
            </CardContent>
          </Card>
        ) : null}

        {labResults ? (
          <Card className="lg:col-span-2" id="laboratory">
            <CardHeader>
              <FlaskConicalIcon className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>Laboratory results</CardTitle>
            </CardHeader>
            <CardContent>
              <PatientLabResults patientId={p.id} results={labResults} />
            </CardContent>
          </Card>
        ) : null}

        {labArchives ? (
          <Card className="lg:col-span-2" id="laboratory-archive">
            <CardHeader>
              <ArchiveIcon className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>Archived laboratory reports</CardTitle>
            </CardHeader>
            <CardContent>
              <ArchivedLabReports archives={labArchives} />
            </CardContent>
          </Card>
        ) : null}

        {externalHistory?.length ? (
          <Card className="lg:col-span-2" id="external-history">
            <CardHeader>
              <FileInputIcon className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>External history (imported)</CardTitle>
            </CardHeader>
            <CardContent>
              <ExternalHistory patientId={p.id} entries={externalHistory} canCorrect={can(session, "interop.fhir.import.review")} />
            </CardContent>
          </Card>
        ) : null}

        <Card className="lg:col-span-2">
          <CardHeader>
            <SmartphoneIcon className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Patient portal (MyHealth)</CardTitle>
          </CardHeader>
          <CardContent>
            {portal?.status === "active" && can(session, "notification.send") ? (
              <div className="mb-3">
                <SendPortalMessage patientId={p.id} />
              </div>
            ) : null}
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

function ClinicalPanel({
  summary,
  patientId,
  canOpenEncounters,
  canOpenCarePlans,
  canManageAllergies,
}: {
  summary: PatientSummaryResponse;
  patientId: string;
  canOpenEncounters: boolean;
  canOpenCarePlans: boolean;
  canManageAllergies: boolean;
}) {
  const { allergies } = summary;
  const vitals = summary.latestVitals[0];
  return (
    <div className="flex flex-col gap-4">
      <SummarySection title="Allergies" icon={ShieldAlertIcon}>
        <AllergiesPanel patientId={patientId} summary={allergies} canManage={canManageAllergies} />
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

      <SummarySection title="Recent encounters">
        {summary.recentEncounters.length ? (
          <ul className="flex flex-col gap-1 text-body">
            {summary.recentEncounters.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2">
                {canOpenEncounters ? (
                  <Link href={`/clinic/encounters/${e.id}`} className="tabular text-primary hover:underline">
                    {e.startedAt ? clinicalDateTime(e.startedAt) : "Encounter"}
                  </Link>
                ) : (
                  <span className="tabular">{e.startedAt ? clinicalDateTime(e.startedAt) : "Encounter"}</span>
                )}
                <span className="text-meta text-muted-foreground">{e.status === "completed" ? "Signed" : label(e.status)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-table text-muted-foreground">None recorded.</p>
        )}
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
                {canOpenCarePlans ? (
                  <Link href={`/clinic/care-plans/${c.id}`} className="text-primary hover:underline">
                    {c.title}
                  </Link>
                ) : (
                  c.title
                )}{" "}
                <span className="text-muted-foreground">· {c.openActivities.length} open activities</span>
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
