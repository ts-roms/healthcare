"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, BanIcon, CheckCircle2Icon, FileInputIcon, MinusCircleIcon, PackageIcon, PlusIcon, ShieldAlertIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import {
  addImmunizationReaction,
  markImmunizationInError,
  recordGivenDose,
  recordReportedDose,
  uploadVaccinationScan,
} from "@/app/(staff)/patients/immunization-actions";
import type { ImmunizationRecord, Vaccine, VaccineStockLot } from "@/lib/api/types";
import {
  BLANK_GIVEN,
  BLANK_REPORTED,
  type GivenForm,
  groupByVaccine,
  immunizationStatus,
  NOT_DONE_REASON_LABEL,
  occurrenceLabel,
  type ReportedForm,
  SOURCE_LABEL,
  stockLotLabel,
  vaccineLabel,
} from "@/lib/immunization-form";
import { filedUnderLookup, filedUnderText } from "@/lib/patient-merge";

const FORMAT = { date: clinicalDate, dateTime: clinicalDateTime };

/** When a dose was given, at the precision known ("2019", "May 2019", a date or a date and time). */
export function OccurrenceText({ record }: { record: Pick<ImmunizationRecord, "occurrence" | "occurrencePrecision"> }) {
  return <span className="tabular">{occurrenceLabel(record.occurrence, record.occurrencePrecision, FORMAT)}</span>;
}

/** Status as colour + icon + text. */
export function ImmunizationStatusBadge({ record }: { record: Pick<ImmunizationRecord, "status" | "enteredInError"> }) {
  const status = immunizationStatus(record);
  const Icon = status.tone === "done" ? CheckCircle2Icon : status.tone === "stopped" ? MinusCircleIcon : BanIcon;
  return (
    <Badge variant={status.variant}>
      <Icon aria-hidden /> {status.label}
    </Badge>
  );
}

/**
 * A patient's immunization history as recorded: doses given here, not given (with the clinician's reason), reported
 * and imported, grouped by vaccine. It says what was recorded, never which dose is due. Entries in error stay listed,
 * struck through. Staff with immunization.record can add a reaction (once) or mark an entry in error.
 */
export function ImmunizationHistory({
  patientId,
  records,
  canRecord,
  grouped = true,
  encounterId,
  linkedRecords,
}: {
  patientId: string;
  records: ImmunizationRecord[];
  canRecord: boolean;
  grouped?: boolean;
  encounterId?: string;
  linkedRecords?: ReadonlyArray<{ id: string; patientNumber: string }>;
}) {
  const filedUnder = filedUnderLookup(linkedRecords);
  if (records.length === 0) return <p className="text-body text-muted-foreground">No immunizations recorded.</p>;
  const groups = grouped ? groupByVaccine(records) : [{ vaccine: "", records }];
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.vaccine || "all"} aria-label={g.vaccine || "Immunizations"} className="flex flex-col gap-1">
          {g.vaccine ? <h3 className="text-table font-semibold">{g.vaccine}</h3> : null}
          <ul className="flex flex-col divide-y rounded-md border">
            {g.records.map((r) => (
              <ImmunizationRow
                key={r.id}
                record={r}
                patientId={patientId}
                canRecord={canRecord}
                encounterId={encounterId}
                filedUnder={filedUnderText(filedUnder(r.patientId))}
                showVaccine={!grouped}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ImmunizationRow({
  record: r,
  patientId,
  canRecord,
  encounterId,
  filedUnder,
  showVaccine,
}: {
  record: ImmunizationRecord;
  patientId: string;
  canRecord: boolean;
  encounterId?: string;
  filedUnder: string | null;
  showVaccine: boolean;
}) {
  const inError = r.enteredInError !== null;
  const where = r.facility?.name ?? r.performerName;
  return (
    <li className="flex flex-col gap-1 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={inError ? "text-body line-through" : "text-body font-medium"}>
          <OccurrenceText record={r} />
          {showVaccine ? ` · ${r.vaccineName}` : ""}
          {r.dose ? ` · ${r.dose}` : ""}
        </span>
        <ImmunizationStatusBadge record={r} />
        <Badge variant="outline">
          {r.source === "external_import" ? <FileInputIcon aria-hidden /> : null}
          {SOURCE_LABEL[r.source]}
        </Badge>
        {r.adverseReaction ? (
          <Badge variant="warning">
            <ShieldAlertIcon aria-hidden /> Reaction recorded
          </Badge>
        ) : null}
        {r.stock ? (
          <span className="flex items-center gap-1 text-meta text-muted-foreground">
            <PackageIcon className="size-3.5" aria-hidden /> {r.stock.returned ? "Stock returned" : "From stock"}
          </span>
        ) : null}
        {filedUnder ? <span className="text-meta text-muted-foreground">· {filedUnder}</span> : null}
      </div>
      <p className="text-meta text-muted-foreground">
        {[
          r.vaccineProduct,
          r.lotNumber ? `Lot ${r.lotNumber}${r.expiryDate ? ` (exp. ${clinicalDate(r.expiryDate)})` : ""}` : null,
          [r.route, r.site].filter(Boolean).join(", ") || null,
          r.doseQuantity !== null && r.doseUnit ? `${r.doseQuantity} ${r.doseUnit}` : null,
          where ? `${r.source === "administered_here" ? "at" : "given by / at"} ${where}` : null,
          r.sourceDescription ? `source: ${r.sourceDescription}` : null,
          r.declaredSource ? `from ${r.declaredSource}` : null,
          `recorded ${clinicalDateTime(r.recordedAt)}${r.recordedByName ? ` by ${r.recordedByName}` : ""}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {r.status === "not_done" && r.notDoneReason ? (
        <p className="text-meta">
          Not given: {NOT_DONE_REASON_LABEL[r.notDoneReason]}
          {r.notDoneReasonText ? ` — ${r.notDoneReasonText}` : ""}
        </p>
      ) : null}
      {r.adverseReaction ? (
        <p className="flex flex-wrap items-center gap-1 text-meta">
          <AlertTriangleIcon className="size-3.5 text-warning-foreground" aria-hidden /> Reaction: {r.adverseReaction}
          {r.adverseReactionRecordedAt ? <span className="text-muted-foreground">({clinicalDateTime(r.adverseReactionRecordedAt)})</span> : null}
          <Link href={`/patients/${patientId}#clinical-summary`} className="text-primary hover:underline">
            Record an allergy if appropriate
          </Link>
        </p>
      ) : null}
      {r.notes ? <p className="text-meta">Note: {r.notes}</p> : null}
      {r.enteredInError ? (
        <p className="text-meta">
          Entered in error: {r.enteredInError.reason}
          {r.enteredInError.byName ? ` (${r.enteredInError.byName}, ${clinicalDateTime(r.enteredInError.at)})` : ""}
        </p>
      ) : null}
      {canRecord && !inError ? <RowActions record={r} patientId={patientId} encounterId={encounterId} /> : null}
    </li>
  );
}

function RowActions({ record, patientId, encounterId }: { record: ImmunizationRecord; patientId: string; encounterId?: string }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"none" | "reaction" | "error">("none");
  const [text, setText] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result =
        mode === "reaction"
          ? await addImmunizationReaction({ patientId, immunizationId: record.id, encounterId, adverseReaction: text })
          : await markImmunizationInError({ patientId, immunizationId: record.id, encounterId, reason: text });
      if (result.ok) {
        toast.success(mode === "reaction" ? "Reaction recorded" : "Marked entered in error");
        setMode("none");
        setText("");
        router.refresh();
      } else toast.error(result.message);
    });
  };
  if (mode === "none") {
    return (
      <div className="flex gap-1">
        {record.status === "completed" && !record.adverseReaction ? (
          <Button type="button" size="xs" variant="ghost" onClick={() => setMode("reaction")}>
            Add reaction…
          </Button>
        ) : null}
        <Button type="button" size="xs" variant="ghost" onClick={() => setMode("error")}>
          Entered in error…
        </Button>
      </div>
    );
  }
  return (
    <form className="flex flex-wrap items-center gap-1.5" onSubmit={submit}>
      <Input
        aria-label={mode === "reaction" ? "Reaction" : "Reason"}
        placeholder={mode === "reaction" ? "What reaction, and when it started" : "Reason (e.g. recorded on the wrong patient)"}
        className="h-7 w-80"
        value={text}
        maxLength={mode === "reaction" ? 1000 : 500}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        type="submit"
        size="xs"
        variant={mode === "error" ? "destructive" : "default"}
        disabled={pending || text.trim().length < (mode === "error" ? 3 : 1)}
      >
        {mode === "reaction" ? "Record reaction" : "Confirm"}
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => setMode("none")}>
        Cancel
      </Button>
      {mode === "error" && record.stock && !record.stock.returned ? (
        <span className="text-meta text-muted-foreground">The dose taken from stock goes back to its lot.</span>
      ) : null}
    </form>
  );
}

/** Records a dose given here — or not given, with the reason — optionally from a stock lot of the facility. */
export function RecordGivenDose({
  patientId,
  vaccines,
  lots,
  encounterId,
  facilitySelected,
  onDone,
}: {
  patientId: string;
  vaccines: Vaccine[];
  lots: VaccineStockLot[] | null;
  encounterId?: string;
  facilitySelected: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<GivenForm>({ ...BLANK_GIVEN, encounterId });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const vaccine = vaccines.find((v) => v.id === form.vaccineId);
  const lot = lots?.find((l) => l.lotId === form.stockLotId);
  const set = <K extends keyof GivenForm>(key: K, value: GivenForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  if (!facilitySelected) return <p className="text-table text-muted-foreground">Select your facility in the top bar to record a dose given here.</p>;
  if (vaccines.length === 0)
    return <p className="text-table text-muted-foreground">No vaccines in the catalogue yet: a clinic administrator adds them under Clinic → Vaccines.</p>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordGivenDose(patientId, form);
      if (result.ok) {
        toast.success(form.given ? `Dose recorded: ${result.data.vaccineName}` : "Recorded as not given");
        setForm({ ...BLANK_GIVEN, encounterId });
        router.refresh();
        onDone?.();
      } else setError(result.message);
    });
  };
  const id = (name: string) => `given-${encounterId ?? "record"}-${name}`;
  return (
    <form onSubmit={submit} noValidate className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6" aria-label="Record a dose given here">
      <div className="grid gap-1 sm:col-span-4">
        <Label htmlFor={id("vaccine")}>Vaccine *</Label>
        <NativeSelect id={id("vaccine")} value={form.vaccineId} onChange={(e) => setForm({ ...form, vaccineId: e.target.value, route: "", site: "" })}>
          <option value="">Choose…</option>
          {vaccines.map((v) => (
            <option key={v.id} value={v.id}>
              {vaccineLabel(v)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={id("given")}>Outcome</Label>
        <NativeSelect id={id("given")} value={form.given ? "given" : "not_given"} onChange={(e) => set("given", e.target.value === "given")}>
          <option value="given">Given</option>
          <option value="not_given">Not given</option>
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={id("date")}>Date given</Label>
        <Input id={id("date")} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        <span className="text-meta text-muted-foreground">Leave empty for now.</span>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={id("dose-label")}>Dose (as you record it)</Label>
        <Input id={id("dose-label")} maxLength={60} placeholder="e.g. Booster" value={form.doseLabel} onChange={(e) => set("doseLabel", e.target.value)} />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={id("dose-number")}>Dose number</Label>
        <Input id={id("dose-number")} inputMode="numeric" maxLength={2} value={form.doseNumber} onChange={(e) => set("doseNumber", e.target.value)} />
        {vaccine?.dosesInSeries ? (
          <span className="text-meta text-muted-foreground">The catalogue lists {vaccine.dosesInSeries} doses in the series.</span>
        ) : null}
      </div>
      {form.given ? (
        <>
          <div className="grid gap-1 sm:col-span-6">
            <Label htmlFor={id("stock")}>From stock</Label>
            <NativeSelect id={id("stock")} value={form.stockLotId} onChange={(e) => set("stockLotId", e.target.value)} disabled={!lots}>
              <option value="">Not from stock (enter the lot below)</option>
              {(lots ?? []).map((l) => (
                <option key={`${l.locationId}-${l.lotId}`} value={l.lotId}>
                  {stockLotLabel(l)}
                </option>
              ))}
            </NativeSelect>
            {lots && lots.length === 0 ? <span className="text-meta text-muted-foreground">No vaccine lots in stock at this facility.</span> : null}
          </div>
          {!lot?.lotNumber ? (
            <>
              <div className="grid gap-1 sm:col-span-3">
                <Label htmlFor={id("lot")}>Lot number *</Label>
                <Input id={id("lot")} maxLength={60} value={form.lotNumber} onChange={(e) => set("lotNumber", e.target.value)} />
              </div>
              <div className="grid gap-1 sm:col-span-3">
                <Label htmlFor={id("expiry")}>Expiry</Label>
                <Input id={id("expiry")} type="date" value={form.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} />
              </div>
            </>
          ) : (
            <p className="text-meta text-muted-foreground sm:col-span-6">
              Lot {lot.lotNumber}
              {lot.expiryDate ? `, expires ${clinicalDate(lot.expiryDate)}` : ""} — taken from stock when you record the dose.
            </p>
          )}
          <OptionField id={id("route")} label="Route" value={form.route ?? ""} options={vaccine?.routes ?? []} onChange={(v) => set("route", v)} />
          <OptionField id={id("site")} label="Site" value={form.site ?? ""} options={vaccine?.sites ?? []} onChange={(v) => set("site", v)} />
          <div className="grid gap-1 sm:col-span-1">
            <Label htmlFor={id("amount")}>Amount</Label>
            <Input id={id("amount")} inputMode="decimal" value={form.doseQuantity} onChange={(e) => set("doseQuantity", e.target.value)} />
          </div>
          <div className="grid gap-1 sm:col-span-1">
            <Label htmlFor={id("unit")}>Unit</Label>
            <Input id={id("unit")} maxLength={20} placeholder="mL" value={form.doseUnit} onChange={(e) => set("doseUnit", e.target.value)} />
          </div>
          <div className="grid gap-1 sm:col-span-6">
            <Label htmlFor={id("reaction")}>Reaction observed (if any)</Label>
            <Input id={id("reaction")} maxLength={1000} value={form.adverseReaction} onChange={(e) => set("adverseReaction", e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor={id("reason")}>Why not given *</Label>
            <NativeSelect id={id("reason")} value={form.notDoneReason} onChange={(e) => set("notDoneReason", e.target.value as GivenForm["notDoneReason"])}>
              <option value="">Choose…</option>
              {Object.entries(NOT_DONE_REASON_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1 sm:col-span-4">
            <Label htmlFor={id("reason-text")}>In your words{form.notDoneReason === "other" ? " *" : ""}</Label>
            <Input id={id("reason-text")} maxLength={500} value={form.notDoneReasonText} onChange={(e) => set("notDoneReasonText", e.target.value)} />
          </div>
        </>
      )}
      <div className="grid gap-1 sm:col-span-6">
        <Label htmlFor={id("notes")}>Notes (staff only)</Label>
        <Textarea id={id("notes")} rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground sm:col-span-6">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-6">
        <Button type="submit" size="sm" disabled={pending || !form.vaccineId}>
          {form.given ? "Record dose given" : "Record not given"}
        </Button>
        {onDone ? (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function OptionField({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1 sm:col-span-2">
      <Label htmlFor={id}>{label}</Label>
      {options.length ? (
        <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input id={id} maxLength={60} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Records a dose reported by the patient or another provider, as precise as the source is. */
export function RecordReportedDose({
  patientId,
  vaccines,
  documents,
  canUpload = false,
  onDone,
}: {
  patientId: string;
  vaccines: Vaccine[];
  /** The patient's uploaded documents that may be linked (e.g. a scan of the vaccination card); null without access. */
  documents: Array<{ id: string; title: string }> | null;
  /** May upload a scan (document.upload). */
  canUpload?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<ReportedForm>(BLANK_REPORTED);
  const [uploaded, setUploaded] = React.useState<Array<{ id: string; title: string }>>([]);
  const [uploading, startUpload] = React.useTransition();
  const upload = (file: File | undefined) => {
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    data.set("idempotencyKey", crypto.randomUUID());
    startUpload(async () => {
      const result = await uploadVaccinationScan(patientId, data);
      if (result.ok) {
        setUploaded((u) => [...u, result.data]);
        setForm((f) => ({ ...f, documentId: result.data.id }));
        toast.success("Scan stored in the patient's record");
      } else toast.error(result.message);
    });
  };
  const linkable = [...(documents ?? []), ...uploaded];
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof ReportedForm>(key: K, value: ReportedForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordReportedDose(patientId, form);
      if (result.ok) {
        toast.success(`Reported dose recorded: ${result.data.vaccineName}`);
        setForm(BLANK_REPORTED);
        router.refresh();
        onDone?.();
      } else setError(result.message);
    });
  };
  return (
    <form onSubmit={submit} noValidate className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6" aria-label="Record a reported dose">
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor="reported-vaccine">Vaccine from the catalogue</Label>
        <NativeSelect id="reported-vaccine" value={form.vaccineId} onChange={(e) => setForm({ ...form, vaccineId: e.target.value, vaccineName: "" })}>
          <option value="">Not in the catalogue (type the name)</option>
          {vaccines.map((v) => (
            <option key={v.id} value={v.id}>
              {vaccineLabel(v)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor="reported-name">Vaccine as written on the source</Label>
        <Input
          id="reported-name"
          maxLength={200}
          disabled={Boolean(form.vaccineId)}
          value={form.vaccineName}
          onChange={(e) => set("vaccineName", e.target.value)}
        />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor="reported-date">When given *</Label>
        <Input id="reported-date" placeholder="2019, 2019-05 or 2019-05-12" value={form.occurrence} onChange={(e) => set("occurrence", e.target.value)} />
        <span className="text-meta text-muted-foreground">A year or month is fine when that is all the source says.</span>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor="reported-dose">Dose (as written)</Label>
        <Input id="reported-dose" maxLength={60} value={form.doseLabel} onChange={(e) => set("doseLabel", e.target.value)} />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor="reported-lot">Lot number</Label>
        <Input id="reported-lot" maxLength={60} value={form.lotNumber} onChange={(e) => set("lotNumber", e.target.value)} />
      </div>
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor="reported-by">Given by / where</Label>
        <Input
          id="reported-by"
          maxLength={200}
          placeholder="e.g. Barangay health station"
          value={form.givenBy}
          onChange={(e) => set("givenBy", e.target.value)}
        />
      </div>
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor="reported-source">Where the information comes from *</Label>
        <Input id="reported-source" maxLength={300} value={form.sourceDescription} onChange={(e) => set("sourceDescription", e.target.value)} />
      </div>
      {documents || canUpload ? (
        <div className="grid gap-1 sm:col-span-4">
          <Label htmlFor="reported-document">Scan on file</Label>
          <NativeSelect id="reported-document" value={form.documentId} onChange={(e) => set("documentId", e.target.value)}>
            <option value="">None</option>
            {linkable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      {canUpload ? (
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="reported-upload">Upload a scan</Label>
          <Input
            id="reported-upload"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/heic"
            disabled={uploading}
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </div>
      ) : null}
      <div className="grid gap-1 sm:col-span-6">
        <Label htmlFor="reported-notes">Notes (staff only)</Label>
        <Textarea id="reported-notes" rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground sm:col-span-6">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-6">
        <Button type="submit" size="sm" disabled={pending}>
          Record reported dose
        </Button>
        {onDone ? (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Buttons that open the two recording forms (one at a time). */
export function RecordImmunizationButtons(props: {
  patientId: string;
  vaccines: Vaccine[];
  lots: VaccineStockLot[] | null;
  documents: Array<{ id: string; title: string }> | null;
  canUpload?: boolean;
  facilitySelected: boolean;
  encounterId?: string;
  reported?: boolean;
}) {
  const [open, setOpen] = React.useState<"none" | "given" | "reported">("none");
  if (open === "given")
    return (
      <RecordGivenDose
        patientId={props.patientId}
        vaccines={props.vaccines}
        lots={props.lots}
        encounterId={props.encounterId}
        facilitySelected={props.facilitySelected}
        onDone={() => setOpen("none")}
      />
    );
  if (open === "reported")
    return (
      <RecordReportedDose
        patientId={props.patientId}
        vaccines={props.vaccines}
        documents={props.documents}
        canUpload={props.canUpload}
        onDone={() => setOpen("none")}
      />
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={() => setOpen("given")}>
        <PlusIcon /> Record dose given here
      </Button>
      {props.reported !== false ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen("reported")}>
          <PlusIcon /> Record reported dose
        </Button>
      ) : null}
    </div>
  );
}
