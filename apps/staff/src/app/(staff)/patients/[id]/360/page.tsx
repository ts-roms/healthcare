import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ActivityIcon,
  AlertOctagonIcon,
  AlertTriangleIcon,
  ClipboardListIcon,
  EyeOffIcon,
  FileTextIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  HistoryIcon,
  InfoIcon,
  type LucideIcon,
  PillIcon,
  StethoscopeIcon,
  SyringeIcon,
  TestTubeIcon,
  UserIcon,
  WaypointsIcon,
  LockIcon,
  NotebookTextIcon,
} from "lucide-react";
import { clinicalDate, clinicalDateTime, LabTrendChart, MedicationList, PatientHeader, ProblemList, VitalSigns } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { PatientLabResults } from "../lab-results";
import { StartConsultationButton } from "@/app/(staff)/clinic/encounters/start-consultation-button";
import { PatientTimelineView, WithheldNote } from "@/components/patient-timeline-view";
import { ReferralList } from "@/components/referral-list";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PatientDetail, PatientLabResult, PatientTimelinePage, PatientWorkspace, PatientWorkspaceSummary } from "@/lib/api/types";
import { canStartConsultation, todayIn, visitStatusLabel } from "@/lib/clinic-mapping";
import { ENCOUNTER_STATUS_LABEL } from "@/lib/encounter-mapping";
import { ITEM_STATUS_LABEL, latestRange, mixedUnits, PRIORITY_LABEL, trendPoints } from "@/lib/lab-mapping";
import { label, toBannerPatient, toVitalSigns } from "@/lib/patient-mapping";
import { filedUnderLookup, filedUnderText } from "@/lib/patient-merge";
import {
  deriveAlerts,
  isWithheld,
  maskedPhilHealthPin,
  nextActivity,
  relevantTests,
  toMedications,
  toProblems,
  trendFromResults,
  type WorkspaceAlert,
  workspaceAccess,
  WITHHELD_TEXT,
} from "@/lib/patient-workspace";
import { EncounterHistory } from "./encounter-history";
import { occurrenceLabel, SOURCE_LABEL } from "@/lib/immunization-form";
import { FamilyStateBadge } from "@/components/history/history-panels";
import { WorkspaceFiles } from "./workspace-files";

// Never put patient names in the tab title (shoulder surfing, browser history).
export const metadata = { title: "Patient 360" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bounded lists: an overview for a doctor under time pressure; each panel links to the full screen. */
const TOP_TESTS = 6;
const TRENDS = 2;
const TIMELINE_ENTRIES = 8;

/** Optional panel data: withheld or failing panels render a short note, never the page's failure. */
async function optional<T>(path: string, query?: Record<string, string | number>): Promise<T | null> {
  try {
    return await api<T>(path, { query });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

/**
 * The doctor's one-screen Patient 360 workspace (CLAUDE.md §29, §39): patient → current consultation → alerts →
 * problems, medicines, care plans → laboratory results and trends → history, images and documents. Every panel is
 * loaded from the API in parallel and gated by its domain's read permission (a withheld panel says so, never "none").
 * Editing stays in the existing screens (encounter workspace, laboratory, dental record), which each panel links to.
 */
export default async function PatientWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, getSession()]);
  if (!UUID.test(id)) notFound();
  const access = workspaceAccess(session.permissions);
  const [patient, summary, workspace, labResults, recent] = await Promise.all([
    api<PatientDetail>(`/patients/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
      throw e;
    }),
    access.clinical ? optional<PatientWorkspaceSummary>(`/patients/${id}/summary`) : Promise.resolve(null),
    optional<PatientWorkspace>(`/patients/${id}/workspace`),
    access.labResults ? optional<PatientLabResult[]>(`/laboratory/patients/${id}/results`) : Promise.resolve(null),
    optional<PatientTimelinePage>(`/patients/${id}/timeline`, { limit: TIMELINE_ENTRIES }),
  ]);

  // A retired (merged) record's care is read with its surviving record.
  if (patient.mergedIntoPatientId) redirect(`/patients/${patient.mergedIntoPatientId}/360`);
  const filedUnder = filedUnderLookup(summary?.linkedRecords ?? workspace?.linkedRecords ?? patient.mergedRecords);
  const pin = maskedPhilHealthPin(patient);
  const alerts = deriveAlerts({ patient, problems: summary?.problemList ?? null, criticalResults: workspace?.criticalResults ?? null });
  const current = workspace?.currentEncounter ?? null;
  const lead = current?.encounters[0];
  const today = todayIn(workspace?.timeZone ?? "Asia/Manila");
  const topTests = labResults ? relevantTests(labResults, TOP_TESTS) : [];
  const trends = labResults
    ? topTests.flatMap((t) => {
        const trend = trendFromResults(labResults, t);
        return trend && !mixedUnits(trend) ? [trend] : [];
      })
    : [];

  return (
    <div className="flex min-h-full flex-col">
      <PatientHeader
        patient={toBannerPatient(patient, summary?.allergies)}
        allergiesHidden={!summary}
        allergiesRecorded={summary ? summary.allergies.status !== "not_reviewed" || summary.allergies.allergies.length > 0 : true}
        details={
          pin ? (
            <div className="flex items-center gap-1">
              <dt className="text-muted-foreground">PhilHealth PIN</dt>
              <dd className="font-mono">{pin}</dd>
            </div>
          ) : null
        }
        aside={
          <>
            {lead && can(session, "encounter.read") ? (
              <Button asChild size="sm">
                <Link href={`/clinic/encounters/${lead.id}`}>
                  <StethoscopeIcon /> Open consultation
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link href={`/patients/${id}`}>
                <UserIcon /> Patient record
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/patients/${id}/timeline`}>
                <HistoryIcon /> Timeline
              </Link>
            </Button>
          </>
        }
      />
      <Alerts alerts={alerts} canOpenCritical={can(session, "lab.result.read")} />
      {patient.mergedRecords?.length ? (
        <p className="flex items-center gap-2 border-b bg-info-subtle px-4 py-2 text-table text-info-foreground">
          <InfoIcon className="size-4 shrink-0" aria-hidden />
          Includes the records of {patient.mergedRecords.map((r) => r.patientNumber).join(", ")} (merged into this patient). Rows filed under another number say
          so.
        </p>
      ) : null}

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* Column 1: now and history */}
        <div className="flex flex-col gap-4">
          <Panel title="Current consultation" icon={StethoscopeIcon}>
            {isWithheld(workspace, "current_encounter") || !current ? (
              <Withheld />
            ) : current.encounters.length ? (
              <ul className="flex flex-col gap-3">
                {current.encounters.map((e) => {
                  const orders = workspace?.labOrders?.filter((o) => o.encounterId === e.id).length;
                  const prescriptions = summary?.activePrescriptions?.filter((p) => p.encounterId === e.id).length;
                  return (
                    <li key={e.id} className="flex flex-col gap-1.5 text-body">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="teal">
                          <ActivityIcon aria-hidden /> {ENCOUNTER_STATUS_LABEL[e.status]}
                        </Badge>
                        {e.modality === "telemedicine" ? <Badge>Online</Badge> : null}
                        {e.mine ? <Badge variant="info">Yours</Badge> : null}
                        {!e.atSelectedFacility ? <Badge variant="outline">Other facility</Badge> : null}
                      </span>
                      <span>
                        {e.visitTypeName ?? "Consultation"} · started <span className="tabular">{clinicalDateTime(e.startedAt)}</span>
                      </span>
                      <span className="text-table text-muted-foreground">
                        {e.practitionerName}
                        {e.facility ? ` · ${e.facility.name}` : ""}
                      </span>
                      <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5 text-table">
                        <dt className="text-muted-foreground">Note</dt>
                        <dd>{e.hasNoteDraft ? "Draft saved, not signed" : "Not started"}</dd>
                        <dt className="text-muted-foreground">Diagnoses</dt>
                        <dd>{e.diagnoses.length ? e.diagnoses.map((d) => d.code ?? d.display).join(", ") : "None yet"}</dd>
                        {orders !== undefined ? (
                          <>
                            <dt className="text-muted-foreground">Lab orders</dt>
                            <dd>{orders ? `${orders} open` : "None open"}</dd>
                          </>
                        ) : null}
                        {prescriptions !== undefined ? (
                          <>
                            <dt className="text-muted-foreground">Prescriptions</dt>
                            <dd>{prescriptions ? `${prescriptions} active` : "None"}</dd>
                          </>
                        ) : null}
                      </dl>
                      <Button asChild size="sm" variant={e.mine ? "default" : "outline"} className="self-start">
                        <Link href={`/clinic/encounters/${e.id}`}>Open in the encounter workspace (notes, diagnoses, orders, prescription)</Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col gap-2 text-body">
                <p className="text-muted-foreground">No consultation in progress.</p>
                {current.visit ? (
                  <>
                    <p>
                      In today&apos;s queue: {visitStatusLabel(current.visit.status)} · {current.visit.visitTypeName} · checked in{" "}
                      <span className="tabular">{clinicalDateTime(current.visit.checkedInAt)}</span>
                    </p>
                    {can(session, "encounter.write") && canStartConsultation(current.visit.status) ? (
                      <StartConsultationButton visit={current.visit} />
                    ) : (
                      <Link href="/queue" className="text-table text-primary hover:underline">
                        Open the queue
                      </Link>
                    )}
                  </>
                ) : (
                  <p className="text-table text-muted-foreground">
                    Consultations start from the queue after check-in (or from Telemedicine for online visits).
                  </p>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Recent consultations" icon={HistoryIcon}>
            {isWithheld(workspace, "encounter_history") || !workspace?.encounterHistory ? (
              <Withheld />
            ) : workspace.encounterHistory.length ? (
              <EncounterHistory encounters={workspace.encounterHistory} currentId={lead?.id} />
            ) : (
              <p className="text-table text-muted-foreground">No consultations recorded.</p>
            )}
          </Panel>

          <Panel
            title="Recent activity"
            icon={HistoryIcon}
            action={
              <Link href={`/patients/${id}/timeline`} className="text-meta text-primary hover:underline">
                Full timeline
              </Link>
            }
          >
            {recent ? (
              <div className="flex flex-col gap-2">
                {recent.items.length ? (
                  <PatientTimelineView entries={recent.items} patientId={id} timeZone={recent.timeZone} />
                ) : recent.withheld.length ? null : (
                  <p className="text-table text-muted-foreground">Nothing recorded yet.</p>
                )}
                <WithheldNote withheld={recent.withheld} />
              </div>
            ) : (
              <Withheld />
            )}
          </Panel>
        </div>

        {/* Column 2: laboratory */}
        <div className="flex flex-col gap-4">
          <Panel
            title="Laboratory results"
            icon={FlaskConicalIcon}
            action={
              labResults?.length ? (
                <Link href={`/patients/${id}#laboratory`} className="text-meta text-primary hover:underline">
                  All results
                </Link>
              ) : null
            }
          >
            {labResults ? (
              <div className="flex flex-col gap-3">
                {labResults.length ? (
                  <p className="text-meta text-muted-foreground">
                    Latest released value of the {topTests.length === 1 ? "most relevant test" : `${topTests.length} most relevant tests`} (critical and
                    abnormal first). Flags are the laboratory&apos;s, against the range recorded with each result.
                  </p>
                ) : null}
                <PatientLabResults patientId={id} results={labResults.filter((r) => topTests.includes(r.testId))} linkedRecords={patient.mergedRecords} />
                {trends.slice(0, TRENDS).map((t) => {
                  const range = latestRange(t);
                  return (
                    <LabTrendChart
                      key={t.analyte}
                      data={trendPoints(t)}
                      name={t.testName}
                      unit={t.unit ?? undefined}
                      referenceLow={range.low}
                      referenceHigh={range.high}
                      height={140}
                    />
                  );
                })}
                {trends.length ? (
                  <p className="text-meta text-muted-foreground">Trends are a display aid (this test only); interpretation remains the clinician&apos;s.</p>
                ) : null}
              </div>
            ) : (
              <Withheld />
            )}
          </Panel>

          <Panel title="Open laboratory orders" icon={TestTubeIcon}>
            {isWithheld(workspace, "lab_orders") || !workspace?.labOrders ? (
              <Withheld />
            ) : workspace.labOrders.length ? (
              <ul className="flex flex-col gap-2 text-body">
                {workspace.labOrders.map((o) => (
                  <li key={o.id} className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono">{o.orderNumber}</span>
                      {o.priority !== "routine" ? (
                        <Badge variant={o.priority === "stat" ? "danger" : "info"}>
                          <AlertTriangleIcon aria-hidden /> {PRIORITY_LABEL[o.priority]}
                        </Badge>
                      ) : null}
                      <span className="tabular text-meta text-muted-foreground">ordered {clinicalDateTime(o.orderedAt)}</span>
                      {o.filedUnder ? <Badge variant="outline">{filedUnderText(o.filedUnder)}</Badge> : null}
                      {o.encounterId && can(session, "encounter.read") ? (
                        <Link href={`/clinic/encounters/${o.encounterId}`} className="text-meta text-primary hover:underline">
                          Consultation
                        </Link>
                      ) : null}
                    </span>
                    <span className="text-table text-muted-foreground">
                      {o.tests.map((t) => `${t.testName}: ${ITEM_STATUS_LABEL[t.status] ?? label(t.status)}`).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-table text-muted-foreground">No open orders.</p>
            )}
          </Panel>

          <Panel
            title="Referrals"
            icon={WaypointsIcon}
            action={
              can(session, "encounter.read") ? (
                <Link href="/clinic/referrals" className="text-meta text-primary hover:underline">
                  Referrals
                </Link>
              ) : null
            }
          >
            {isWithheld(workspace, "referrals") || !workspace?.referrals ? (
              <Withheld />
            ) : (
              <ReferralList referrals={workspace.referrals} empty="No referrals." />
            )}
          </Panel>

          <Panel
            title="Images and documents"
            icon={FileTextIcon}
            action={
              can(session, "dental.record.read") ? (
                <Link href={`/dental/patients/${id}`} className="text-meta text-primary hover:underline">
                  Dental record
                </Link>
              ) : null
            }
          >
            {isWithheld(workspace, "dental_images") && isWithheld(workspace, "documents") ? (
              <Withheld />
            ) : workspace?.dentalImages?.length || workspace?.documents?.length ? (
              <div className="flex flex-col gap-2">
                <WorkspaceFiles images={workspace.dentalImages} documents={workspace.documents} />
                {isWithheld(workspace, "dental_images") ? (
                  <p className="text-meta text-muted-foreground">Dental images: {WITHHELD_TEXT.toLowerCase()}</p>
                ) : null}
                {isWithheld(workspace, "documents") ? <p className="text-meta text-muted-foreground">Documents: {WITHHELD_TEXT.toLowerCase()}</p> : null}
              </div>
            ) : (
              <p className="text-table text-muted-foreground">No images or documents.</p>
            )}
          </Panel>
        </div>

        {/* Column 3: clinical summary */}
        <div className="flex flex-col gap-4">
          <Panel title="Problem list" icon={ActivityIcon}>
            {summary ? <ProblemList problems={toProblems(summary.problemList, filedUnder)} /> : <Withheld />}
          </Panel>

          <Panel title="Active medications" icon={PillIcon}>
            {summary?.activePrescriptions ? <MedicationList medications={toMedications(summary.activePrescriptions, filedUnder)} /> : <Withheld />}
          </Panel>

          <Panel title="Care plans" icon={ClipboardListIcon}>
            {summary?.openCarePlans ? (
              summary.openCarePlans.length ? (
                <ul className="flex flex-col gap-2 text-body">
                  {summary.openCarePlans.map((c) => {
                    const next = nextActivity(c, today);
                    return (
                      <li key={c.id} className="flex flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/clinic/care-plans/${c.id}`} className="font-medium text-primary hover:underline">
                            {c.title}
                          </Link>
                          <span className="text-meta text-muted-foreground">
                            {label(c.status)} · {c.openActivities.length} open activit{c.openActivities.length === 1 ? "y" : "ies"}
                          </span>
                        </span>
                        {next ? (
                          <span className="flex flex-wrap items-center gap-1.5 text-table">
                            Next: {next.description} · <span className="tabular">{clinicalDate(next.dueDate)}</span>
                            {next.overdue ? (
                              <Badge variant="warning">
                                <AlertTriangleIcon aria-hidden /> Overdue
                              </Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-table text-muted-foreground">No open care plans.</p>
              )
            ) : (
              <Withheld />
            )}
          </Panel>

          <Panel
            title="Immunizations"
            icon={SyringeIcon}
            action={
              can(session, "immunization.read") ? (
                <Link href={`/patients/${id}/immunizations`} className="text-meta text-primary hover:underline">
                  Full history
                </Link>
              ) : null
            }
          >
            {isWithheld(workspace, "immunizations") || !workspace?.immunizations ? (
              <Withheld />
            ) : workspace.immunizations.length ? (
              <ul className="flex flex-col gap-1.5 text-body">
                {workspace.immunizations.map((i) => (
                  <li key={i.id} className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{i.vaccineName}</span>
                      {i.dose ? <span className="text-muted-foreground">· {i.dose}</span> : null}
                      {i.status === "not_done" ? (
                        <Badge variant="warning">
                          <AlertTriangleIcon aria-hidden /> Not given
                        </Badge>
                      ) : null}
                      {i.hasReaction ? (
                        <Badge variant="warning">
                          <AlertOctagonIcon aria-hidden /> Reaction recorded
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-meta text-muted-foreground">
                      {[
                        occurrenceLabel(i.occurrence, i.occurrencePrecision, { date: clinicalDate, dateTime: clinicalDateTime }),
                        SOURCE_LABEL[i.source],
                        i.facility?.name,
                        filedUnderText(i.filedUnder),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-table text-muted-foreground">No immunizations recorded.</p>
            )}
          </Panel>

          <Panel
            title="Medical, family and social history"
            icon={NotebookTextIcon}
            action={
              can(session, "history.read") ? (
                <Link href={`/patients/${id}/history`} className="text-meta text-primary hover:underline">
                  Full history
                </Link>
              ) : null
            }
          >
            {isWithheld(workspace, "history") || !workspace?.history ? (
              <Withheld />
            ) : (
              <div className="flex flex-col gap-2 text-body">
                <FamilyStateBadge state={workspace.history.family.state} latestReview={null} />
                {workspace.history.family.entries.length ? (
                  <p className="text-table">
                    <span className="text-muted-foreground">Family:</span>{" "}
                    {workspace.history.family.entries
                      .map((f) => `${f.relative} — ${f.condition}${f.onsetAge !== null ? ` (from ${f.onsetAge})` : ""}`)
                      .join("; ")}
                    {workspace.history.family.total > workspace.history.family.entries.length
                      ? ` and ${workspace.history.family.total - workspace.history.family.entries.length} more`
                      : ""}
                  </p>
                ) : null}
                <p className="text-table">
                  <span className="text-muted-foreground">Past procedures:</span>{" "}
                  {workspace.history.procedures.length
                    ? workspace.history.procedures
                        .map((h) => [h.description, h.performed ? `(${h.performed})` : null, filedUnderText(h.filedUnder)].filter(Boolean).join(" "))
                        .join("; ")
                    : "none recorded"}
                  {workspace.history.proceduresTotal > workspace.history.procedures.length
                    ? ` and ${workspace.history.proceduresTotal - workspace.history.procedures.length} more`
                    : ""}
                </p>
                <p className="text-table">
                  <span className="text-muted-foreground">Past conditions:</span>{" "}
                  {workspace.history.conditions.length ? workspace.history.conditions.map((h) => h.description).join("; ") : "none recorded"}
                  {workspace.history.conditionsTotal > workspace.history.conditions.length
                    ? ` and ${workspace.history.conditionsTotal - workspace.history.conditions.length} more`
                    : ""}
                </p>
                {workspace.history.social ? (
                  <p className="text-table">
                    <span className="text-muted-foreground">Social (as of {clinicalDate(workspace.history.social.effectiveDate)}):</span>{" "}
                    {[
                      workspace.history.social.tobacco ? `tobacco ${workspace.history.social.tobacco.toLowerCase()}` : null,
                      workspace.history.social.alcohol ? `alcohol ${workspace.history.social.alcohol.toLowerCase()}` : null,
                      workspace.history.social.occupation,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "recorded"}
                  </p>
                ) : (
                  <p className="text-table text-muted-foreground">Social history not recorded.</p>
                )}
                {workspace.history.social?.substanceUse || workspace.history.social?.sexualHistory ? (
                  <p className="flex items-start gap-1.5 text-table">
                    <LockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span>
                      <span className="text-muted-foreground">Sensitive:</span>{" "}
                      {[
                        workspace.history.social.substanceUse ? `substance use — ${workspace.history.social.substanceUse}` : null,
                        workspace.history.social.sexualHistory ? `sexual history — ${workspace.history.social.sexualHistory}` : null,
                      ]
                        .filter(Boolean)
                        .join("; ")}
                    </span>
                  </p>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title="Latest vitals" icon={HeartPulseIcon}>
            {summary ? (
              summary.latestVitals[0] ? (
                <VitalSigns vitals={toVitalSigns(summary.latestVitals[0])} />
              ) : (
                <p className="text-table text-muted-foreground">No vital signs recorded.</p>
              )
            ) : (
              <Withheld />
            )}
          </Panel>
        </div>
      </div>
      <p className="px-4 pb-4 text-meta text-muted-foreground">
        Every panel shows only what your role may read; opening this workspace is recorded in the audit trail. Times are in the facility&apos;s time zone.
      </p>
    </div>
  );
}

function Panel({ title, icon: Icon, action, children }: { title: string; icon: LucideIcon; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>{title}</CardTitle>
        {action ? <span className="ml-auto">{action}</span> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Withheld() {
  return (
    <p className="flex items-center gap-1.5 text-table text-muted-foreground">
      <EyeOffIcon className="size-4 shrink-0" aria-hidden /> {WITHHELD_TEXT}
    </p>
  );
}

const ALERT_ICON: Record<WorkspaceAlert["tone"], LucideIcon> = { critical: AlertOctagonIcon, warning: AlertTriangleIcon, info: InfoIcon };
const ALERT_VARIANT: Record<WorkspaceAlert["tone"], "critical" | "warning" | "info"> = { critical: "critical", warning: "warning", info: "info" };

/** Alerts under the banner: icon + colour + text, critical first. */
function Alerts({ alerts, canOpenCritical }: { alerts: WorkspaceAlert[]; canOpenCritical: boolean }) {
  if (!alerts.length) return null;
  return (
    <ul aria-label="Alerts" className="flex flex-wrap gap-1.5 border-b bg-card px-4 py-2">
      {alerts.map((a) => {
        const Icon = ALERT_ICON[a.tone];
        const badge = (
          <Badge variant={ALERT_VARIANT[a.tone]} className="h-auto whitespace-normal">
            <Icon aria-hidden /> {a.text}
          </Badge>
        );
        return (
          <li key={a.key} role={a.tone === "critical" ? "alert" : undefined}>
            {a.href && canOpenCritical ? (
              <Link href={a.href} className="hover:underline">
                {badge}
              </Link>
            ) : (
              badge
            )}
          </li>
        );
      })}
    </ul>
  );
}
