"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CalendarPlusIcon, FileClockIcon, FileSignatureIcon, PencilLineIcon, SaveIcon, XCircleIcon } from "lucide-react";
import type { Patient } from "@healthcare/domain";
import { DoctorLayout } from "@healthcare/ui/layouts";
import { AllergiesPanel } from "@/components/allergies-panel";
import { LabResultsSummary } from "@/components/lab-results-summary";
import { clinicalDate, clinicalDateTime, PatientHeader, SummarySection, VitalSigns } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Kbd,
  Label,
  Textarea,
  toast,
} from "@healthcare/ui/primitives";
import type {
  CarePlanDetail,
  CodingSystem,
  Encounter,
  EncounterDetail,
  LabOrder,
  LabPanel,
  LabTest,
  MedicalCertificate,
  Practitioner,
  Referral,
  NoteRevision,
  PatientLabResult,
  PatientSummaryResponse,
  Prescription,
  TelemedicineConsultation,
  PatientHistory,
} from "@/lib/api/types";
import { addDays, FOLLOW_UP_PRESETS } from "@/lib/care-plan-form";
import {
  diagnosisLabel,
  ENCOUNTER_STATUS_LABEL,
  type EncounterControls,
  isNoteDirty,
  noteFromRevision,
  notePayload,
  noteReadyToSign,
  prescriptionControls,
  REVISION_KIND_LABEL,
} from "@/lib/encounter-mapping";
import { label, toVitalSigns } from "@/lib/patient-mapping";
import { amendNote, loadRevisions, markEncounterEnteredInError, saveNote, signEncounter } from "../actions";
import { CarePlansPanel, type FollowUpContext, followUpHref } from "./care-plans-panel";
import { CertificatesPanel } from "./certificates-panel";
import { type EncounterImmunizations, ImmunizationsPanel } from "./immunizations-panel";
import { type EncounterProcedures, ProceduresPanel } from "./procedures-panel";
import { HistoryPanel } from "./history-panel";
import { ReferralsPanel } from "./referrals-panel";
import { DiagnosesPanel } from "./diagnoses-panel";
import { LabOrdersPanel } from "./lab-orders-panel";
import { NoteConflict, NoteEditor } from "./note-editor";
import { TelemedicinePanel } from "./telemedicine-panel";
import { PrescriptionsPanel } from "./prescriptions-panel";

type HistoryItem = Encounter & { practitionerName: string | null };

export function EncounterWorkspace({
  encounter,
  banner,
  summary,
  practitionerName,
  history,
  codingSystems,
  controls,
  prescriptions,
  prescriptionPermissions,
  carePlans,
  followUp,
  canManageCarePlans,
  canBookFollowUp,
  canManageAllergies,
  telemedicine,
  lab,
  certificates,
  immunizations = null,
  procedures = null,
  medicalHistory = null,
  referrals,
}: {
  encounter: EncounterDetail;
  banner: Patient;
  summary: PatientSummaryResponse | null;
  practitionerName: string | null;
  history: HistoryItem[];
  codingSystems: CodingSystem[];
  controls: EncounterControls;
  /** null: the user may not read prescriptions. */
  prescriptions: Prescription[] | null;
  prescriptionPermissions: string[];
  /** Open care plans with details; null: the user may not read care plans. */
  carePlans: CarePlanDetail[] | null;
  followUp: FollowUpContext;
  canManageCarePlans: boolean;
  /** appointment.manage: may book a follow-up. */
  canBookFollowUp: boolean;
  canManageAllergies: boolean;
  /** Online consultations: the video and escalation panel. */
  telemedicine: { consultation: TelemedicineConsultation; canConduct: boolean; bookInPersonHref: string | null } | null;
  lab: {
    /** null: the user may not read laboratory orders. */
    orders: LabOrder[] | null;
    tests: LabTest[];
    panels: LabPanel[];
    /** The patient's released results; null: no access. */
    results: PatientLabResult[] | null;
    canOrder: boolean;
    canCancel: boolean;
  };
  /** Medical certificates of this consultation (items null: no access). */
  certificates: { items: MedicalCertificate[] | null; canIssue: boolean; canVoid: boolean };
  /** Immunizations: this consultation's doses and the history (null: no access). */
  immunizations?: EncounterImmunizations | null;
  /** Procedures performed in this consultation (null: no access). */
  procedures?: EncounterProcedures | null;
  /** Past procedures and conditions, family and social history (history null: no access). */
  medicalHistory?: { history: PatientHistory | null; canRecord: boolean } | null;
  /** Referrals from this consultation (items null: no access). */
  referrals: { items: Referral[] | null; canRefer: boolean; practitioners: Practitioner[]; currentPractitionerId: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const latestRevision = encounter.note?.revisionNumber ?? 0;
  const saved = React.useMemo(() => noteFromRevision(encounter.note), [encounter.note]);
  const [note, setNote] = React.useState(saved);
  // The revision the clinician's text is based on; it differs from the latest only after a conflict.
  const [baseRevision, setBaseRevision] = React.useState(latestRevision);
  const [conflict, setConflict] = React.useState(false);
  const [amending, setAmending] = React.useState(false);
  const [amendReason, setAmendReason] = React.useState("");
  const [errorOpen, setErrorOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const dirty = isNoteDirty(saved, note) || baseRevision !== latestRevision;
  const editable = controls.editNote || amending;
  const template = { templateKey: encounter.note?.templateKey ?? "soap", sections: encounter.note?.sections ?? {} };

  // Warn before leaving with unsaved clinical text.
  React.useEffect(() => {
    if (!dirty || !editable) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, editable]);

  const onConflict = (code: string | undefined) => {
    if (code === "note_revision_conflict") {
      setConflict(true);
      router.refresh();
    }
  };

  /** Saves the note as a new draft revision; false (with the error shown) when it was refused. */
  const persist = async (): Promise<number | null> => {
    const result = await saveNote({ encounterId: encounter.id, basedOnRevision: baseRevision, ...template, ...notePayload(note) });
    if (result.ok) {
      setBaseRevision(result.data.revisionNumber);
      setConflict(false);
      return result.data.revisionNumber;
    }
    toast.error(result.message);
    onConflict(result.code);
    return null;
  };

  const save = () => {
    if (!controls.editNote || !dirty) return;
    startTransition(async () => {
      const revision = await persist();
      if (revision === null) return;
      toast.success("Draft saved", { description: `Revision ${revision}` });
      router.refresh();
    });
  };

  // Leaving the workspace inside the app (e.g. to book the follow-up) skips beforeunload: save the note first so an
  // unsaved draft is never lost on the way.
  const leaveTo = (href: string) => (e: React.MouseEvent) => {
    if (!controls.editNote || !dirty) return;
    e.preventDefault();
    startTransition(async () => {
      if ((await persist()) === null) return;
      toast.success("Draft saved");
      router.push(href);
    });
  };

  // Ctrl/Cmd+S saves the draft — clinicians shouldn't need the mouse.
  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sign = () => {
    if (!noteReadyToSign(note)) {
      toast.error("Document at least an assessment or plan before signing.");
      return;
    }
    startTransition(async () => {
      const result = await signEncounter({
        encounterId: encounter.id,
        version: encounter.version,
        draft: dirty ? { basedOnRevision: baseRevision, ...template, ...notePayload(note) } : undefined,
      });
      if (result.ok) {
        toast.success("Encounter signed", { description: "The visit is complete." });
        setBaseRevision(latestRevision + (dirty ? 2 : 1));
        router.refresh();
      } else {
        toast.error(result.message);
        onConflict(result.code);
        if (result.code === "version_conflict") router.refresh();
      }
    });
  };

  const amend = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await amendNote({ encounterId: encounter.id, basedOnRevision: latestRevision, reason: amendReason, ...template, ...notePayload(note) });
      if (result.ok) {
        toast.success("Amendment saved", { description: "The signed version stays in the history." });
        setAmending(false);
        setAmendReason("");
        setBaseRevision(result.data.revisionNumber);
        router.refresh();
      } else {
        toast.error(result.message);
        onConflict(result.code);
      }
    });
  };

  const current = encounter.status === "in_progress";
  const triage = encounter.triage[0];

  return (
    <>
      <DoctorLayout
        header={
          <>
            <PatientHeader
              patient={banner}
              variant="compact"
              allergiesHidden={!summary}
              allergiesRecorded={summary ? summary.allergies.status !== "not_reviewed" : true}
              aside={
                <span className="flex flex-wrap items-center gap-2 text-table">
                  <Badge variant={current ? "teal" : encounter.status === "completed" ? "success" : "warning"}>
                    {ENCOUNTER_STATUS_LABEL[encounter.status]}
                  </Badge>
                  <span className="tabular text-muted-foreground">{clinicalDateTime(encounter.startedAt)}</span>
                  {practitionerName ? <span className="text-muted-foreground">{practitionerName}</span> : null}
                  {encounter.modality === "telemedicine" ? <Badge>Online</Badge> : null}
                  <Link href={`/patients/${encounter.patientId}/360`} className="text-primary hover:underline">
                    Patient 360
                  </Link>
                </span>
              }
            />
            {encounter.status === "entered_in_error" ? (
              <p role="alert" className="flex items-center gap-2 border-b border-warning/40 bg-warning-subtle px-4 py-2 text-table text-warning-foreground">
                <AlertTriangleIcon className="size-4" aria-hidden /> Entered in error: {encounter.enteredInErrorReason}. This record is kept for audit and is
                not part of the patient&apos;s care.
              </p>
            ) : null}
          </>
        }
        left={{
          title: "Encounters",
          content: (
            <ol className="-mx-1 flex flex-col gap-1">
              {history.map((e) => {
                const selected = e.id === encounter.id;
                return (
                  <li key={e.id}>
                    <Link
                      href={`/clinic/encounters/${e.id}`}
                      aria-current={selected ? "page" : undefined}
                      className={`flex flex-col rounded-md px-2 py-1.5 text-table hover:bg-accent ${selected ? "bg-primary-subtle" : ""}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="tabular font-medium">{clinicalDate(e.startedAt)}</span>
                        <span
                          className={`ml-auto text-meta ${e.status === "entered_in_error" ? "text-muted-foreground line-through" : "text-muted-foreground"}`}
                        >
                          {ENCOUNTER_STATUS_LABEL[e.status]}
                        </span>
                      </span>
                      <span className="truncate text-muted-foreground">
                        {[e.chiefComplaint, e.practitionerName].filter(Boolean).join(" · ") || "Consultation"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          ),
        }}
        center={{
          title: current ? "Current encounter" : "Encounter",
          action: encounter.revisionCount ? (
            <Button size="xs" variant="ghost" onClick={() => setHistoryOpen(true)}>
              <FileClockIcon /> {encounter.revisionCount} revision{encounter.revisionCount === 1 ? "" : "s"}
            </Button>
          ) : null,
          content: (
            <div className="flex flex-col gap-5">
              {telemedicine ? (
                <TelemedicinePanel
                  consultation={telemedicine.consultation}
                  canConduct={telemedicine.canConduct}
                  bookInPersonHref={telemedicine.bookInPersonHref}
                />
              ) : null}
              {encounter.chiefComplaint ? (
                <p className="text-body">
                  <span className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">Chief complaint </span>
                  {encounter.chiefComplaint}
                </p>
              ) : null}
              {conflict && baseRevision !== latestRevision ? (
                <NoteConflict
                  latest={saved}
                  onUseLatest={() => {
                    setNote(saved);
                    setBaseRevision(latestRevision);
                    setConflict(false);
                  }}
                  onKeepMine={() => {
                    setBaseRevision(latestRevision);
                    setConflict(false);
                  }}
                />
              ) : null}
              {encounter.note?.kind === "amendment" && !amending ? (
                <p className="text-meta text-muted-foreground">
                  Amended {clinicalDateTime(encounter.note.authoredAt)}: {encounter.note.amendmentReason}
                </p>
              ) : null}
              <NoteEditor value={note} onChange={setNote} readOnly={!editable} />
              {amending ? (
                <form onSubmit={amend} className="flex flex-wrap items-end gap-2 rounded-md border border-warning/40 p-2">
                  <div className="grid min-w-64 flex-1 gap-1">
                    <Label htmlFor="amend-reason">Reason for amendment *</Label>
                    <Input id="amend-reason" maxLength={500} value={amendReason} onChange={(e) => setAmendReason(e.target.value)} />
                  </div>
                  <Button type="submit" size="sm" disabled={pending || amendReason.trim().length < 3 || !isNoteDirty(saved, note)}>
                    Save amendment
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAmending(false);
                      setNote(saved);
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : null}
              <DiagnosesPanel
                encounterId={encounter.id}
                diagnoses={encounter.diagnoses}
                codingSystems={codingSystems}
                canEdit={controls.addDiagnosis}
                needsReason={controls.diagnosisNeedsReason}
              />
              <PrescriptionsPanel
                encounterId={encounter.id}
                prescriptions={prescriptions}
                controls={prescriptionControls(encounter.status, prescriptionPermissions)}
                allergies={banner.allergies}
                allergyStatus={summary ? summary.allergies.status : "unknown"}
              />
              <LabOrdersPanel
                encounterId={encounter.id}
                patientId={encounter.patientId}
                orders={lab.orders}
                tests={lab.tests}
                panels={lab.panels}
                canOrder={lab.canOrder}
                canCancel={lab.canCancel}
                defaultIndication={encounter.diagnoses
                  .filter((d) => d.status === "active")
                  .map((d) => diagnosisLabel(d))
                  .join("; ")
                  .slice(0, 1000)}
              />
              <CertificatesPanel
                encounterId={encounter.id}
                signed={encounter.status === "completed"}
                certificates={certificates.items}
                canIssue={certificates.canIssue}
                canVoid={certificates.canVoid}
                suggestedFindings={encounter.diagnoses
                  .filter((d) => d.status === "active")
                  .map((d) => d.display)
                  .join("; ")
                  .slice(0, 2000)}
                today={followUp.today}
              />
              <ProceduresPanel
                encounterId={encounter.id}
                patientId={encounter.patientId}
                status={encounter.status}
                inPerson={encounter.modality === "in_person"}
                data={procedures}
              />
              <ImmunizationsPanel
                encounterId={encounter.id}
                patientId={encounter.patientId}
                open={encounter.status !== "entered_in_error"}
                data={immunizations}
              />
              <HistoryPanel
                encounterId={encounter.id}
                patientId={encounter.patientId}
                history={medicalHistory?.history ?? null}
                canRecord={medicalHistory?.canRecord ?? false}
                open={encounter.status !== "entered_in_error"}
              />
              <ReferralsPanel
                encounterId={encounter.id}
                referrals={referrals.items}
                canRefer={referrals.canRefer}
                practitioners={referrals.practitioners}
                currentPractitionerId={referrals.currentPractitionerId}
                diagnoses={encounter.diagnoses.filter((d) => d.status === "active").map((d) => ({ id: d.id, label: diagnosisLabel(d) }))}
              />
              <CarePlansPanel
                plans={carePlans}
                followUp={{ ...followUp, onLeave: leaveTo }}
                encounterId={encounter.id}
                diagnoses={encounter.diagnoses.filter((d) => d.status === "active").map((d) => ({ id: d.id, label: diagnosisLabel(d) }))}
                canManage={canManageCarePlans && encounter.status !== "entered_in_error"}
                canBook={canBookFollowUp && encounter.status !== "entered_in_error"}
              />
              <section className="flex flex-col gap-2">
                <h3 className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">This visit</h3>
                {triage ? (
                  <p className="text-table">
                    Triage {clinicalDateTime(triage.assessedAt)} · {label(triage.priority)}
                    {triage.painScore !== null ? ` · pain ${triage.painScore}/10` : ""}
                    {triage.riskFlags.length ? ` · ${triage.riskFlags.join(", ")}` : ""}
                    {triage.notes ? <span className="block text-muted-foreground">{triage.notes}</span> : null}
                  </p>
                ) : (
                  <p className="text-table text-muted-foreground">No triage recorded.</p>
                )}
                {encounter.vitals.length ? (
                  encounter.vitals.map((v) => <VitalSigns key={v.id} vitals={toVitalSigns(v)} />)
                ) : (
                  <p className="text-table text-muted-foreground">No vital signs for this visit.</p>
                )}
              </section>
            </div>
          ),
        }}
        right={{
          title: "Clinical context",
          content: summary ? (
            <div className="flex flex-col gap-3">
              <SummarySection title="Allergies">
                <AllergiesPanel patientId={encounter.patientId} summary={summary.allergies} canManage={canManageAllergies} />
              </SummarySection>
              <SummarySection title="Problems">
                {summary.problemList.length ? (
                  <ul className="flex flex-col gap-0.5 text-table">
                    {summary.problemList.map((p) => (
                      <li key={p.id}>
                        {p.code ? <span className="font-mono">{p.code} </span> : null}
                        {p.display}
                        {p.isChronic ? <span className="text-muted-foreground"> · chronic</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-table text-muted-foreground">None recorded.</p>
                )}
              </SummarySection>
              {summary.activePrescriptions ? (
                <SummarySection title="Active prescriptions">
                  {summary.activePrescriptions.length ? (
                    <ul className="flex flex-col gap-0.5 text-table">
                      {summary.activePrescriptions.flatMap((rx) =>
                        rx.items.map((item, i) => (
                          <li key={`${rx.id}-${i}`}>
                            {item.genericName}
                            {item.strength ? ` ${item.strength}` : ""} <span className="text-muted-foreground">· {clinicalDate(rx.issuedAt)}</span>
                          </li>
                        )),
                      )}
                    </ul>
                  ) : (
                    <p className="text-table text-muted-foreground">None.</p>
                  )}
                </SummarySection>
              ) : null}
              {carePlans === null && summary.openCarePlans?.length ? (
                <SummarySection title="Care plans">
                  <ul className="flex flex-col gap-0.5 text-table">
                    {summary.openCarePlans.map((c) => (
                      <li key={c.id}>
                        {c.title} <span className="text-muted-foreground">· {c.openActivities.length} open</span>
                      </li>
                    ))}
                  </ul>
                </SummarySection>
              ) : null}
              {lab.results ? (
                <SummarySection title="Recent laboratory results">
                  <LabResultsSummary results={lab.results} limit={6} href={`/patients/${encounter.patientId}#laboratory`} />
                </SummarySection>
              ) : null}
              <SummarySection title="Latest vitals">
                {summary.latestVitals[0] ? (
                  <VitalSigns vitals={toVitalSigns(summary.latestVitals[0])} className="gap-x-3" />
                ) : (
                  <p className="text-table text-muted-foreground">None recorded.</p>
                )}
              </SummarySection>
            </div>
          ) : (
            <p className="text-table text-muted-foreground">The clinical summary needs clinical access.</p>
          ),
        }}
        actions={
          <>
            {controls.markEnteredInError ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setErrorOpen(true)}>
                <XCircleIcon /> Opened in error…
              </Button>
            ) : null}
            {canBookFollowUp && encounter.status !== "entered_in_error" ? (
              <span className="flex flex-wrap items-center gap-1 text-meta text-muted-foreground">
                <CalendarPlusIcon className="size-4" aria-hidden /> Follow-up in
                {FOLLOW_UP_PRESETS.map((p) => {
                  const href = followUpHref(followUp, { date: addDays(followUp.today, p.days), reason: "Follow-up" });
                  return (
                    <Button key={p.days} asChild size="xs" variant="outline">
                      <Link href={href} onClick={leaveTo(href)}>
                        {p.label}
                      </Link>
                    </Button>
                  );
                })}
              </span>
            ) : null}
            <span className="ml-auto text-meta text-muted-foreground" role="status">
              {editable ? (dirty ? "Unsaved changes" : encounter.note ? `Saved · revision ${latestRevision}` : "Not saved yet") : null}
            </span>
            {controls.editNote ? (
              <Button size="sm" variant="outline" disabled={pending || !dirty} onClick={save}>
                <SaveIcon /> Save draft <Kbd className="ml-1 hidden md:inline-flex">Ctrl S</Kbd>
              </Button>
            ) : null}
            {controls.sign ? (
              <Button size="sm" disabled={pending} onClick={sign}>
                <FileSignatureIcon /> Sign encounter
              </Button>
            ) : null}
            {controls.amend && !amending ? (
              <Button size="sm" variant="outline" onClick={() => setAmending(true)}>
                <PencilLineIcon /> Amend note
              </Button>
            ) : null}
          </>
        }
      />
      <EnteredInErrorDialog encounterId={encounter.id} open={errorOpen} onOpenChange={setErrorOpen} />
      <RevisionHistoryDialog encounterId={encounter.id} open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  );
}

function EnteredInErrorDialog({ encounterId, open, onOpenChange }: { encounterId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encounter opened in error</DialogTitle>
          <DialogDescription>
            Use this for a wrong patient or a duplicate. The encounter is kept for audit but marked entered in error, and the patient returns to the queue as
            ready for the provider.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await markEncounterEnteredInError({ encounterId, reason });
              if (result.ok) {
                toast.success("Encounter marked entered in error");
                onOpenChange(false);
                router.push("/queue");
              } else toast.error(result.message);
            });
          }}
        >
          <Label htmlFor="eie-reason">Reason *</Label>
          <Textarea
            id="eie-reason"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Opened for the wrong patient"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep encounter
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || reason.trim().length < 3}>
              Mark entered in error
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevisionHistoryDialog({ encounterId, open, onOpenChange }: { encounterId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [revisions, setRevisions] = React.useState<NoteRevision[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadRevisions({ encounterId }).then((result) => {
      if (cancelled) return;
      if (result.ok) setRevisions([...result.data].reverse());
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [open, encounterId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Note history</DialogTitle>
          <DialogDescription>Every saved draft, the signed version and amendments. Nothing is overwritten.</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-danger-foreground">{error}</p> : null}
        {!revisions && !error ? <p className="text-muted-foreground">Loading…</p> : null}
        <ol className="flex max-h-[60vh] flex-col gap-3 overflow-auto">
          {revisions?.map((r) => (
            <li key={r.id} className="rounded-md border p-2.5">
              <p className="flex flex-wrap items-center gap-2 text-table">
                <span className="font-semibold">Revision {r.revisionNumber}</span>
                <Badge variant={r.kind === "signed" ? "success" : r.kind === "amendment" ? "warning" : "neutral"}>{REVISION_KIND_LABEL[r.kind]}</Badge>
                <span className="tabular text-muted-foreground">{clinicalDateTime(r.authoredAt)}</span>
              </p>
              {r.amendmentReason ? <p className="text-meta text-muted-foreground">Reason: {r.amendmentReason}</p> : null}
              <div className="mt-1.5">
                <NoteEditor value={noteFromRevision(r)} onChange={() => undefined} readOnly />
              </div>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
