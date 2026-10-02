"use client";

import * as React from "react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { registerPatient } from "@/app/(staff)/patients/new/actions";
import { registerWalkIn } from "@/app/(staff)/queue/actions";
import { recordTriage } from "@/app/(staff)/queue/visits/[id]/triage/actions";
import { nextReplayable, type OfflineAction, outboxCounts, parkOrphans, pruneDone, resolvePatient, resolveVisit } from "@/lib/offline/outbox";
import { clearActions, loadActions, offlineStorageAvailable, saveActions } from "@/lib/offline/store";
import { type RegistrationForm, registrationFormSchema } from "@/lib/patient-registration";
import { EMPTY_VITALS, parseVitals, VITAL_FIELDS, type VitalField, type VitalsForm } from "@/lib/triage-form";
import { findPatientByNumber } from "./actions";

export interface OfflineSnapshot {
  takenAt: string;
  facilityName: string | null;
  visits: Array<{
    id: string;
    ticket: string;
    patientNumber: string;
    displayName: string;
    chiefComplaint: string;
    priority: "routine" | "urgent" | "emergency";
  }>;
  visitTypes: Array<{ id: string; name: string }>;
  practitioners: Array<{ id: string; name: string }>;
}

const STATUS: Record<OfflineAction["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  replaying: { label: "Sending", tone: "info" },
  done: { label: "Sent", tone: "success" },
  parked: { label: "Needs attention", tone: "warning" },
};

export function OfflineWorkspace({
  snapshot,
  permissions,
}: {
  snapshot: OfflineSnapshot;
  permissions: { register: boolean; walkIn: boolean; triage: boolean };
}) {
  const online = React.useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [actions, setActions] = React.useState<OfflineAction[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [replaying, setReplaying] = React.useState(false);
  const supported = typeof window !== "undefined" && offlineStorageAvailable();

  const persist = React.useCallback(async (next: OfflineAction[]) => {
    setActions(next);
    await saveActions(next);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void loadActions().then((loaded) => {
      if (cancelled) return;
      setActions(pruneDone(loaded, new Date()));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const capture = (action: OfflineAction) => {
    void persist([...actions, action]);
    toast.success(`Captured: ${action.label}`, { description: online ? "Select Send now to send it." : "It will be sent when the connection returns." });
  };

  /** Replays one action at a time, in capture order, through the same server actions as the live screens. */
  const replay = React.useCallback(async () => {
    if (replaying) return;
    setReplaying(true);
    let current = parkOrphans(await loadActions());
    try {
      for (;;) {
        const next = nextReplayable(current);
        if (!next) break;
        current = current.map((a) => (a.id === next.id ? { ...a, status: "replaying" } : a)) as OfflineAction[];
        await persist(current);
        const outcome = await replayOne(next, current);
        current = parkOrphans(current.map((a) => (a.id === next.id ? outcome : a)) as OfflineAction[]);
        await persist(current);
        if (outcome.status === "done") toast.success(`Sent: ${next.label}`);
        else toast.error(`${next.label}: ${outcome.parked?.message ?? "could not be sent"}`);
      }
    } finally {
      setReplaying(false);
    }
  }, [persist, replaying]);

  // Whenever the connection is back and something waits, send it.
  React.useEffect(() => {
    if (!(online && loaded && outboxCounts(actions).waiting > 0 && !replaying)) return;
    const timer = setTimeout(() => void replay(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when connectivity or the loaded outbox changes
  }, [online, loaded]);

  const counts = outboxCounts(actions);
  const offlinePatients = actions.filter((a): a is Extract<OfflineAction, { kind: "register" }> => a.kind === "register" && a.status !== "parked");
  const offlineWalkIns = actions.filter((a): a is Extract<OfflineAction, { kind: "walk_in" }> => a.kind === "walk_in" && a.status !== "parked");

  if (!supported) {
    return <p className="p-4 text-table text-danger-foreground">This browser cannot keep an offline outbox (no IndexedDB, session storage or Web Crypto).</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p role="status" className="text-table">
        {online ? "Connected." : "No connection."} Snapshot of {snapshot.facilityName ?? "no facility"} as of {clinicalDateTime(snapshot.takenAt)}
        {online ? " — reload this page for a fresh one." : "."} Captured actions stay in this browser tab only, encrypted; closing the tab discards what was not
        sent.
      </p>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Outbox {counts.waiting > 0 ? <Badge variant="info">{counts.waiting} waiting</Badge> : null}{" "}
            {counts.parked > 0 ? <Badge variant="warning">{counts.parked} need attention</Badge> : null}
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void replay()} disabled={!online || replaying || counts.waiting === 0}>
              Send now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (counts.waiting > 0 && !window.confirm("Discard actions that were not sent?")) return;
                void clearActions().then(() => setActions([]));
              }}
              disabled={replaying || actions.length === 0}
            >
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-table text-muted-foreground">Nothing captured.</p>
          ) : (
            <ul className="flex flex-col divide-y text-table">
              {[...actions]
                .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
                .map((a) => (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <div>
                      <p>
                        <span className="font-medium">{a.label}</span> <Badge variant={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                      </p>
                      <p className="text-meta text-muted-foreground">
                        {kindLabel(a.kind)} · captured {clinicalDateTime(a.capturedAt)}
                        {a.kind === "register" && a.result ? ` · patient no. ${a.result.patientNumber}` : ""}
                        {a.kind === "walk_in" && a.result ? ` · ticket ${a.result.ticket}` : ""}
                      </p>
                      {a.parked ? (
                        <p className="text-meta text-warning-foreground">
                          {a.parked.message}
                          {a.parked.candidates?.length
                            ? ` Possible duplicates: ${a.parked.candidates.map((c) => `${c.displayName} (${c.patientNumber})`).join(", ")}. Register on the live screen to review them.`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    {a.status === "parked" ? (
                      <Button size="sm" variant="ghost" onClick={() => void persist(actions.filter((x) => x.id !== a.id))}>
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {permissions.register ? <RegisterForm onCapture={capture} /> : null}
        {permissions.walkIn ? <WalkInForm snapshot={snapshot} offlinePatients={offlinePatients} onCapture={capture} /> : null}
        {permissions.triage ? <VitalsForm snapshot={snapshot} offlineWalkIns={offlineWalkIns} onCapture={capture} /> : null}
      </div>
    </div>
  );
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function kindLabel(kind: OfflineAction["kind"]): string {
  return kind === "register" ? "Registration" : kind === "walk_in" ? "Walk-in check-in" : "Triage and vital signs";
}

/** One action against the API through its live server action; the outcome replaces the action in the outbox. */
async function replayOne(action: OfflineAction, all: OfflineAction[]): Promise<OfflineAction> {
  const park = (
    code: string,
    message: string,
    candidates?: OfflineAction["parked"] extends infer P ? (P extends { candidates?: infer C } ? C : never) : never,
  ): OfflineAction => ({ ...action, status: "parked", parked: { code, message, ...(candidates ? { candidates } : {}) } }) as OfflineAction;
  try {
    if (action.kind === "register") {
      const result = await registerPatient(action.payload.form, action.id);
      if (result.ok) return { ...action, status: "done", result: { patientId: result.patient.id, patientNumber: result.patient.patientNumber } };
      if (result.kind === "duplicates") {
        return park(
          "possible_duplicates",
          result.message,
          result.candidates.map((c) => ({
            patientId: c.patient.id,
            patientNumber: c.patient.patientNumber,
            displayName: c.patient.displayName,
            reason: c.reasons?.[0] ?? "",
          })),
        );
      }
      return park(result.kind, result.message);
    }
    if (action.kind === "walk_in") {
      const patient = resolvePatient(action.payload.patient, all);
      if (!patient) return park("patient_unresolved", "The patient's registration did not go through.");
      let patientId: string;
      if ("patientId" in patient) patientId = patient.patientId;
      else {
        const found = await findPatientByNumber(patient.patientNumber);
        if (!found.ok) return park("lookup_failed", found.message);
        if (!found.data) return park("patient_not_found", `No single active patient has the number ${patient.patientNumber}.`);
        patientId = found.data.patientId;
      }
      const result = await registerWalkIn(
        { patientId, visitTypeId: action.payload.visitTypeId, priority: action.payload.priority, chiefComplaint: action.payload.chiefComplaint },
        action.id,
      );
      if (result.ok) return { ...action, status: "done", result: { visitId: result.data.id, ticket: result.data.ticket } };
      return park(result.code ?? "refused", result.message);
    }
    const visitId = resolveVisit(action.payload.visit, all);
    if (!visitId) return park("visit_unresolved", "The walk-in check-in did not go through.");
    const result = await recordTriage(
      {
        visitId,
        chiefComplaint: action.payload.chiefComplaint,
        priority: action.payload.priority,
        riskFlags: [],
        vitals: action.payload.vitals,
        completeTriage: action.payload.completeTriage,
      },
      action.id,
    );
    if (result.ok) return { ...action, status: "done", result: { visitId } };
    return park(result.code ?? "refused", result.message);
  } catch (error) {
    // The network dropped again mid-way: leave it waiting for the next attempt (the idempotency key makes that safe).
    return { ...action, status: "waiting" } as OfflineAction;
    void error;
  }
}

function RegisterForm({ onCapture }: { onCapture: (action: OfflineAction) => void }) {
  const [form, setForm] = React.useState({ familyName: "", givenName: "", middleName: "", sex: "", birthDate: "", mobile: "", cityMunicipality: "" });
  const [error, setError] = React.useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Register a patient</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          aria-label="Offline registration"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = registrationFormSchema.safeParse({ ...form, sex: form.sex || undefined });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "Check the fields.");
              return;
            }
            setError(null);
            const values: RegistrationForm = parsed.data;
            onCapture({
              id: crypto.randomUUID(),
              kind: "register",
              status: "waiting",
              capturedAt: new Date().toISOString(),
              label: `${values.familyName.toUpperCase()}, ${values.givenName}`,
              payload: { form: values },
            });
            setForm({ familyName: "", givenName: "", middleName: "", sex: "", birthDate: "", mobile: "", cityMunicipality: "" });
          }}
        >
          <Field id="of-family" label="Family name *">
            <Input id="of-family" value={form.familyName} onChange={set("familyName")} required />
          </Field>
          <Field id="of-given" label="Given name *">
            <Input id="of-given" value={form.givenName} onChange={set("givenName")} required />
          </Field>
          <Field id="of-middle" label="Middle name">
            <Input id="of-middle" value={form.middleName} onChange={set("middleName")} />
          </Field>
          <Field id="of-sex" label="Sex *">
            <NativeSelect id="of-sex" value={form.sex} onChange={set("sex")} placeholder="Choose…">
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="intersex">Intersex</option>
              <option value="unknown">Unknown</option>
            </NativeSelect>
          </Field>
          <Field id="of-birth" label="Birth date *">
            <Input id="of-birth" type="date" value={form.birthDate} onChange={set("birthDate")} required />
          </Field>
          <Field id="of-mobile" label="Mobile">
            <Input id="of-mobile" value={form.mobile} onChange={set("mobile")} inputMode="tel" placeholder="0917 123 4567" />
          </Field>
          <Field id="of-city" label="City or municipality">
            <Input id="of-city" value={form.cityMunicipality} onChange={set("cityMunicipality")} />
          </Field>
          {error ? <p className="text-meta text-danger-foreground">{error}</p> : null}
          <p className="text-meta text-muted-foreground">
            Duplicate checking happens when it is sent; a possible duplicate waits here for you to review on the live screen.
          </p>
          <Button type="submit" size="sm">
            Capture registration
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function WalkInForm({
  snapshot,
  offlinePatients,
  onCapture,
}: {
  snapshot: OfflineSnapshot;
  offlinePatients: Array<Extract<OfflineAction, { kind: "register" }>>;
  onCapture: (action: OfflineAction) => void;
}) {
  const [who, setWho] = React.useState<string>("number");
  const [patientNumber, setPatientNumber] = React.useState("");
  const [visitTypeId, setVisitTypeId] = React.useState(snapshot.visitTypes[0]?.id ?? "");
  const [priority, setPriority] = React.useState<"routine" | "urgent" | "emergency">("routine");
  const [chiefComplaint, setChiefComplaint] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Check in a walk-in</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          aria-label="Offline walk-in"
          onSubmit={(e) => {
            e.preventDefault();
            if (!visitTypeId) {
              setError("Choose a visit type.");
              return;
            }
            const patient =
              who === "number" ? ({ kind: "number", patientNumber: patientNumber.trim() } as const) : ({ kind: "offline", actionId: who } as const);
            if (patient.kind === "number" && patient.patientNumber.length < 3) {
              setError("Enter the patient number, or choose a patient registered here.");
              return;
            }
            setError(null);
            const label =
              patient.kind === "number"
                ? `Walk-in · patient no. ${patient.patientNumber}`
                : `Walk-in · ${offlinePatients.find((p) => p.id === patient.actionId)?.label ?? "offline patient"}`;
            onCapture({
              id: crypto.randomUUID(),
              kind: "walk_in",
              status: "waiting",
              capturedAt: new Date().toISOString(),
              label,
              payload: { patient, visitTypeId, priority, chiefComplaint: chiefComplaint.trim() || undefined },
            });
            setPatientNumber("");
            setChiefComplaint("");
          }}
        >
          <Field id="ow-who" label="Patient">
            <NativeSelect id="ow-who" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="number">By patient number…</option>
              {offlinePatients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} (registered here)
                </option>
              ))}
            </NativeSelect>
          </Field>
          {who === "number" ? (
            <Field id="ow-number" label="Patient number">
              <Input id="ow-number" value={patientNumber} onChange={(e) => setPatientNumber(e.target.value)} placeholder="As printed on the patient's card" />
            </Field>
          ) : null}
          <Field id="ow-type" label="Visit type *">
            <NativeSelect id="ow-type" value={visitTypeId} onChange={(e) => setVisitTypeId(e.target.value)} emptyText="No visit types in the snapshot">
              {snapshot.visitTypes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="ow-priority" label="Priority">
            <NativeSelect id="ow-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </NativeSelect>
          </Field>
          <Field id="ow-complaint" label="Chief complaint">
            <Textarea id="ow-complaint" value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} rows={2} maxLength={500} />
          </Field>
          {error ? <p className="text-meta text-danger-foreground">{error}</p> : null}
          <Button type="submit" size="sm">
            Capture check-in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VitalsForm({
  snapshot,
  offlineWalkIns,
  onCapture,
}: {
  snapshot: OfflineSnapshot;
  offlineWalkIns: Array<Extract<OfflineAction, { kind: "walk_in" }>>;
  onCapture: (action: OfflineAction) => void;
}) {
  const [visit, setVisit] = React.useState<string>(snapshot.visits[0]?.id ?? offlineWalkIns[0]?.id ?? "");
  const [chiefComplaint, setChiefComplaint] = React.useState("");
  const [priority, setPriority] = React.useState<"routine" | "urgent" | "emergency">("routine");
  const [vitals, setVitals] = React.useState<VitalsForm>(EMPTY_VITALS);
  const [complete, setComplete] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const existing = snapshot.visits.find((v) => v.id === visit);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Triage and vital signs</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          aria-label="Offline vital signs"
          onSubmit={(e) => {
            e.preventDefault();
            const { values, errors } = parseVitals(vitals);
            const complaint = (chiefComplaint || existing?.chiefComplaint || "").trim();
            if (Object.keys(errors).length > 0) {
              setError(Object.values(errors)[0] ?? "Check the vital signs.");
              return;
            }
            if (!visit) {
              setError("Choose a visit.");
              return;
            }
            if (!complaint) {
              setError("Record the chief complaint.");
              return;
            }
            setError(null);
            const ref = existing
              ? ({ kind: "existing", visitId: existing.id, ticket: existing.ticket } as const)
              : ({ kind: "offline", actionId: visit } as const);
            const label = existing
              ? `Vitals · ${existing.ticket} ${existing.displayName}`
              : `Vitals · ${offlineWalkIns.find((w) => w.id === visit)?.label ?? "offline walk-in"}`;
            onCapture({
              id: crypto.randomUUID(),
              kind: "triage",
              status: "waiting",
              capturedAt: new Date().toISOString(),
              label,
              payload: { visit: ref, chiefComplaint: complaint, priority, vitals: values, completeTriage: complete },
            });
            setVitals(EMPTY_VITALS);
            setChiefComplaint("");
          }}
        >
          <Field id="ov-visit" label="Visit *">
            <NativeSelect id="ov-visit" value={visit} onChange={(e) => setVisit(e.target.value)} emptyText="No visits in the snapshot">
              {snapshot.visits.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.ticket} · {v.displayName}
                </option>
              ))}
              {offlineWalkIns.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label} (checked in here)
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="ov-complaint" label="Chief complaint *">
            <Input
              id="ov-complaint"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder={existing?.chiefComplaint || undefined}
              maxLength={500}
            />
          </Field>
          <Field id="ov-priority" label="Priority">
            <NativeSelect id="ov-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(VITAL_FIELDS) as VitalField[]).map((field) => (
              <Field key={field} id={`ov-${field}`} label={`${VITAL_FIELDS[field].label} (${VITAL_FIELDS[field].unit})`}>
                <Input id={`ov-${field}`} inputMode="decimal" value={vitals[field]} onChange={(e) => setVitals({ ...vitals, [field]: e.target.value })} />
              </Field>
            ))}
          </div>
          <label className="flex items-center gap-2 text-table">
            <Checkbox checked={complete} onCheckedChange={(v) => setComplete(v === true)} /> Triage complete (ready for the provider)
          </label>
          {error ? <p className="text-meta text-danger-foreground">{error}</p> : null}
          <Button type="submit" size="sm">
            Capture vital signs
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
