"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button, Checkbox, Input, Label, NativeSelect, Textarea } from "@healthcare/ui/primitives";
import type { PortalHealthHistory } from "@/lib/api/types";
import {
  buildSubmission,
  CONDITION_STATUS_OPTIONS,
  type ConditionDraft,
  EMPTY_CONDITION,
  EMPTY_FAMILY,
  EMPTY_MEDICINE,
  EMPTY_PROCEDURE,
  type FamilyDraft,
  MEDICATION_STATUS_OPTIONS,
  type MedicineDraft,
  type ProcedureDraft,
  RELATIONSHIP_OPTIONS,
  type SocialDraft,
  socialDraftFrom,
  submissionMessage,
  USE_OPTIONS,
} from "@/lib/health-history";
import { submitHealthHistory } from "./actions";

const DATE_HINT = "Year, month or day: 2019, 2019-05 or 2019-05-12. Leave blank if not known.";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-meta text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Rows<T>({
  title,
  intro,
  rows,
  empty,
  add,
  remove,
  render,
}: {
  title: string;
  intro: string;
  rows: T[];
  empty: T;
  add: (row: T) => void;
  remove: (index: number) => void;
  render: (row: T, index: number) => React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <legend className="px-1 font-semibold">{title}</legend>
      <p className="text-meta text-muted-foreground">{intro}</p>
      {rows.map((row, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-lg border p-3">
          {render(row, index)}
          <Button type="button" size="sm" variant="ghost" className="self-end" onClick={() => remove(index)}>
            <Trash2Icon aria-hidden /> Remove
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => add(empty)}>
        <PlusIcon aria-hidden /> Add {rows.length ? "another" : "one"}
      </Button>
    </fieldset>
  );
}

/**
 * The health history questionnaire: medicines taken, past illnesses, operations, the family and daily life, answered
 * in one go and sent as one submission. Everything is "as you tell us": the clinic records it as reported by you and
 * corrects a mistake at the clinic. Other substance use and sexual history are not asked here.
 */
export function QuestionnaireForm({ social, actingForSomeone }: { social: PortalHealthHistory["social"]; actingForSomeone: boolean }) {
  const router = useRouter();
  const [medications, setMedications] = React.useState<MedicineDraft[]>([]);
  const [conditions, setConditions] = React.useState<ConditionDraft[]>([]);
  const [procedures, setProcedures] = React.useState<ProcedureDraft[]>([]);
  const [family, setFamily] = React.useState<FamilyDraft[]>([]);
  const [socialDraft, setSocialDraft] = React.useState<SocialDraft>(() => socialDraftFrom(social));
  const [socialTouched, setSocialTouched] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [key] = React.useState(() => `hh-${crypto.randomUUID()}`);

  const update = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, index: number, patch: Partial<T>) =>
    set((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const setSocial = (patch: Partial<SocialDraft>) => {
    setSocialTouched(true);
    setSocialDraft((s) => ({ ...s, ...patch }));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const built = buildSubmission({ medications, conditions, procedures, family, social: socialDraft, socialTouched });
    if (!built.ok) return setError(built.problem);
    startTransition(async () => {
      setError(null);
      const result = await submitHealthHistory(built.body, key);
      if (!result.ok) return setError(submissionMessage(result.code, result.message));
      setDone(`Sent. Your clinic now has ${result.data.entryIds.length} new ${result.data.entryIds.length === 1 ? "entry" : "entries"} from you.`);
      router.refresh();
    });
  };

  if (done) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-success-subtle p-3 text-body text-success-foreground">
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> {done}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Health history questionnaire">
      <Rows
        title="Medicines you take that the clinic did not prescribe"
        intro="Medicines from another doctor, over the counter, vitamins, supplements or herbal remedies. Write them as they appear on the box."
        rows={medications}
        empty={EMPTY_MEDICINE}
        add={(row) => setMedications((r) => [...r, row])}
        remove={(i) => setMedications((r) => r.filter((_, j) => j !== i))}
        render={(m, i) => (
          <>
            <Field id={`med-${i}-name`} label="Medicine">
              <Input
                id={`med-${i}-name`}
                value={m.medication}
                maxLength={200}
                required
                onChange={(e) => update(setMedications, i, { medication: e.target.value })}
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field id={`med-${i}-dose`} label="How you take it (optional)">
                <Input
                  id={`med-${i}-dose`}
                  value={m.dose}
                  maxLength={200}
                  placeholder="1 tablet every morning"
                  onChange={(e) => update(setMedications, i, { dose: e.target.value })}
                />
              </Field>
              <Field id={`med-${i}-reason`} label="What it is for (optional)">
                <Input id={`med-${i}-reason`} value={m.reason} maxLength={300} onChange={(e) => update(setMedications, i, { reason: e.target.value })} />
              </Field>
              <Field id={`med-${i}-by`} label="Who prescribed it or where it came from (optional)">
                <Input
                  id={`med-${i}-by`}
                  value={m.prescribedBy}
                  maxLength={300}
                  placeholder="Over the counter"
                  onChange={(e) => update(setMedications, i, { prescribedBy: e.target.value })}
                />
              </Field>
              <Field id={`med-${i}-status`} label="Do you take it now?">
                <NativeSelect
                  id={`med-${i}-status`}
                  value={m.status}
                  onChange={(e) => update(setMedications, i, { status: e.target.value as MedicineDraft["status"] })}
                >
                  {MEDICATION_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={`med-${i}-started`} label="Since when (optional)" hint={DATE_HINT}>
                <Input id={`med-${i}-started`} value={m.started} inputMode="numeric" onChange={(e) => update(setMedications, i, { started: e.target.value })} />
              </Field>
              {m.status === "stopped" ? (
                <Field id={`med-${i}-stopped`} label="Stopped when (optional)" hint={DATE_HINT}>
                  <Input
                    id={`med-${i}-stopped`}
                    value={m.stopped}
                    inputMode="numeric"
                    onChange={(e) => update(setMedications, i, { stopped: e.target.value })}
                  />
                </Field>
              ) : null}
            </div>
          </>
        )}
      />

      <Rows
        title="Past illnesses"
        intro="Illnesses a doctor told you about before, anywhere, for example diabetes, asthma, tuberculosis."
        rows={conditions}
        empty={EMPTY_CONDITION}
        add={(row) => setConditions((r) => [...r, row])}
        remove={(i) => setConditions((r) => r.filter((_, j) => j !== i))}
        render={(c, i) => (
          <>
            <Field id={`cond-${i}-name`} label="Illness">
              <Input
                id={`cond-${i}-name`}
                value={c.description}
                maxLength={300}
                required
                onChange={(e) => update(setConditions, i, { description: e.target.value })}
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field id={`cond-${i}-status`} label="Do you still have it?">
                <NativeSelect
                  id={`cond-${i}-status`}
                  value={c.status}
                  onChange={(e) => update(setConditions, i, { status: e.target.value as ConditionDraft["status"] })}
                >
                  {CONDITION_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={`cond-${i}-onset`} label="Since when (optional)" hint={DATE_HINT}>
                <Input id={`cond-${i}-onset`} value={c.onset} inputMode="numeric" onChange={(e) => update(setConditions, i, { onset: e.target.value })} />
              </Field>
              <Field id={`cond-${i}-by`} label="Where it was diagnosed or treated (optional)">
                <Input id={`cond-${i}-by`} value={c.diagnosedBy} maxLength={300} onChange={(e) => update(setConditions, i, { diagnosedBy: e.target.value })} />
              </Field>
            </div>
          </>
        )}
      />

      <Rows
        title="Operations and procedures"
        intro="Operations or procedures you had anywhere, for example appendectomy, caesarean section."
        rows={procedures}
        empty={EMPTY_PROCEDURE}
        add={(row) => setProcedures((r) => [...r, row])}
        remove={(i) => setProcedures((r) => r.filter((_, j) => j !== i))}
        render={(p, i) => (
          <>
            <Field id={`proc-${i}-name`} label="Operation or procedure">
              <Input
                id={`proc-${i}-name`}
                value={p.description}
                maxLength={300}
                required
                onChange={(e) => update(setProcedures, i, { description: e.target.value })}
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field id={`proc-${i}-when`} label="When (optional)" hint={DATE_HINT}>
                <Input
                  id={`proc-${i}-when`}
                  value={p.performed}
                  inputMode="numeric"
                  onChange={(e) => update(setProcedures, i, { performed: e.target.value })}
                />
              </Field>
              <Field id={`proc-${i}-where`} label="Where or by whom (optional)">
                <Input id={`proc-${i}-where`} value={p.performer} maxLength={300} onChange={(e) => update(setProcedures, i, { performer: e.target.value })} />
              </Field>
              <Field id={`proc-${i}-site`} label="Which part of the body (optional)">
                <Input
                  id={`proc-${i}-site`}
                  value={p.bodySite}
                  maxLength={120}
                  placeholder="left knee"
                  onChange={(e) => update(setProcedures, i, { bodySite: e.target.value })}
                />
              </Field>
            </div>
          </>
        )}
      />

      <Rows
        title="Illnesses in the family"
        intro="Conditions your blood relatives have or had, for example diabetes, high blood pressure, cancer."
        rows={family}
        empty={EMPTY_FAMILY}
        add={(row) => setFamily((r) => [...r, row])}
        remove={(i) => setFamily((r) => r.filter((_, j) => j !== i))}
        render={(f, i) => (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field id={`fam-${i}-rel`} label="Relative">
                <NativeSelect
                  id={`fam-${i}-rel`}
                  value={f.relationship}
                  onChange={(e) => update(setFamily, i, { relationship: e.target.value as FamilyDraft["relationship"] })}
                >
                  {RELATIONSHIP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={`fam-${i}-rel-text`} label={f.relationship === "other" ? "Who" : "Detail (optional)"}>
                <Input
                  id={`fam-${i}-rel-text`}
                  value={f.relationshipText}
                  maxLength={100}
                  placeholder={f.relationship === "other" ? "Great-aunt" : "older sister"}
                  onChange={(e) => update(setFamily, i, { relationshipText: e.target.value })}
                />
              </Field>
            </div>
            <Field id={`fam-${i}-cond`} label="Condition">
              <Input id={`fam-${i}-cond`} value={f.condition} maxLength={300} required onChange={(e) => update(setFamily, i, { condition: e.target.value })} />
            </Field>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field id={`fam-${i}-age`} label="Age when it began (optional)">
                <Input
                  id={`fam-${i}-age`}
                  value={f.onsetAge}
                  inputMode="numeric"
                  maxLength={3}
                  onChange={(e) => update(setFamily, i, { onsetAge: e.target.value })}
                />
              </Field>
              <Field id={`fam-${i}-dec`} label="Has this relative passed away?">
                <NativeSelect
                  id={`fam-${i}-dec`}
                  value={f.deceased}
                  onChange={(e) => update(setFamily, i, { deceased: e.target.value as FamilyDraft["deceased"] })}
                >
                  <option value="">Not saying</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </NativeSelect>
              </Field>
              {f.deceased === "yes" ? (
                <Field id={`fam-${i}-cause`} label="Cause, if known (optional)">
                  <Input
                    id={`fam-${i}-cause`}
                    value={f.causeOfDeath}
                    maxLength={300}
                    onChange={(e) => update(setFamily, i, { causeOfDeath: e.target.value })}
                  />
                </Field>
              ) : null}
            </div>
          </>
        )}
      />

      <fieldset className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <legend className="px-1 font-semibold">Daily life</legend>
        <p className="text-meta text-muted-foreground">
          {social ? "What the clinic has is filled in; change only what is different. " : ""}
          Leave anything you would rather not answer blank. Other substance use and sexual history are discussed at the clinic, not here.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field id="soc-tobacco" label="Do you smoke or use tobacco?">
            <NativeSelect
              id="soc-tobacco"
              value={socialDraft.tobaccoStatus}
              placeholder="Choose…"
              onChange={(e) => setSocial({ tobaccoStatus: e.target.value as SocialDraft["tobaccoStatus"] })}
            >
              {USE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {socialDraft.tobaccoStatus === "current" || socialDraft.tobaccoStatus === "former" ? (
            <>
              <Field id="soc-tobacco-type" label="What (optional)">
                <Input
                  id="soc-tobacco-type"
                  value={socialDraft.tobaccoType}
                  maxLength={120}
                  placeholder="Cigarettes, vape"
                  onChange={(e) => setSocial({ tobaccoType: e.target.value })}
                />
              </Field>
              <Field id="soc-tobacco-amount" label="How much (optional)">
                <Input
                  id="soc-tobacco-amount"
                  value={socialDraft.tobaccoAmount}
                  maxLength={120}
                  placeholder="10 sticks a day"
                  onChange={(e) => setSocial({ tobaccoAmount: e.target.value })}
                />
              </Field>
            </>
          ) : null}
          {socialDraft.tobaccoStatus === "former" ? (
            <Field id="soc-tobacco-quit" label="Year you stopped (optional)">
              <Input
                id="soc-tobacco-quit"
                value={socialDraft.tobaccoQuitYear}
                inputMode="numeric"
                maxLength={4}
                onChange={(e) => setSocial({ tobaccoQuitYear: e.target.value })}
              />
            </Field>
          ) : null}
          <Field id="soc-alcohol" label="Do you drink alcohol?">
            <NativeSelect
              id="soc-alcohol"
              value={socialDraft.alcoholStatus}
              placeholder="Choose…"
              onChange={(e) => setSocial({ alcoholStatus: e.target.value as SocialDraft["alcoholStatus"] })}
            >
              {USE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {socialDraft.alcoholStatus === "current" || socialDraft.alcoholStatus === "former" ? (
            <Field id="soc-alcohol-freq" label="How often (optional)">
              <Input
                id="soc-alcohol-freq"
                value={socialDraft.alcoholFrequency}
                maxLength={200}
                placeholder="A few bottles at weekends"
                onChange={(e) => setSocial({ alcoholFrequency: e.target.value })}
              />
            </Field>
          ) : null}
          <Field id="soc-work" label="Your work (optional)">
            <Input id="soc-work" value={socialDraft.occupation} maxLength={200} onChange={(e) => setSocial({ occupation: e.target.value })} />
          </Field>
          <Field id="soc-exposures" label="Anything at work that may affect your health (optional)">
            <Input
              id="soc-exposures"
              value={socialDraft.occupationalExposures}
              maxLength={1000}
              placeholder="Dust, chemicals, night shifts"
              onChange={(e) => setSocial({ occupationalExposures: e.target.value })}
            />
          </Field>
        </div>
        <Field id="soc-home" label="Who you live with (optional)">
          <Textarea
            id="soc-home"
            value={socialDraft.livingSituation}
            maxLength={1000}
            rows={2}
            onChange={(e) => setSocial({ livingSituation: e.target.value })}
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field id="soc-activity" label="Physical activity (optional)">
            <Textarea
              id="soc-activity"
              value={socialDraft.physicalActivity}
              maxLength={1000}
              rows={2}
              onChange={(e) => setSocial({ physicalActivity: e.target.value })}
            />
          </Field>
          <Field id="soc-diet" label="Diet (optional)">
            <Textarea id="soc-diet" value={socialDraft.diet} maxLength={1000} rows={2} onChange={(e) => setSocial({ diet: e.target.value })} />
          </Field>
        </div>
      </fieldset>

      <label className="flex items-start gap-2 text-body">
        <Checkbox className="mt-0.5" checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
        <span>
          {actingForSomeone ? "What I entered is what this person told me, " : "What I entered is true "}
          as far as I know. I understand the clinic will keep it as reported {actingForSomeone ? "by a relative" : "by me"} and that it is not a diagnosis.
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending || !confirmed}>
        {pending ? "Sending…" : "Send to the clinic"}
      </Button>
    </form>
  );
}
