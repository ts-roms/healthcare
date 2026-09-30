"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EyeOffIcon, PlusIcon, SmartphoneIcon } from "lucide-react";
import { toothLabel, type ToothNotation } from "@healthcare/domain";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { DentalChartEffect, DentalPortalSetting, DentalProcedureSite, DentalProcedureType, DentalSettings } from "@/lib/api/types";
import { PROCEDURE_SITES } from "@/lib/dental-mapping";
import {
  createProcedureType,
  setFeeEstimates,
  setNotation,
  setPortalDentalRecords,
  setPortalPlanDecisions,
  setProcedureAlternatives,
  setProcedureTypeStatus,
} from "../actions";

const EFFECTS: Record<DentalChartEffect, string> = {
  restoration: "Restoration (on the treated surfaces)",
  sealant: "Sealant (on the treated surfaces)",
  crown: "Crown",
  root_canal: "Root canal",
  missing: "Missing (extraction)",
  implant: "Implant",
  pontic: "Pontic",
};
const SURFACE_EFFECTS: DentalChartEffect[] = ["restoration", "sealant"];

const NOTATIONS: Record<ToothNotation, string> = { fdi: "FDI (ISO 3950)", universal: "Universal", palmer: "Palmer" };

export function DentalSettingsForm({
  settings,
  portal,
  facility,
  canManage,
}: {
  settings: DentalSettings;
  portal: DentalPortalSetting;
  facility: { id: string; name: string } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({ code: "", name: "", site: "tooth" as DentalProcedureSite, chartEffect: "" });
  const effects = (Object.keys(EFFECTS) as DentalChartEffect[]).filter((e) =>
    form.site === "mouth" ? false : form.site === "surface" ? SURFACE_EFFECTS.includes(e) : !SURFACE_EFFECTS.includes(e),
  );

  const act = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(done);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Procedures</CardTitle>
          <span className="ml-auto text-meta text-muted-foreground">No national dental code set is assumed — use the clinic&apos;s own codes</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="divide-y text-table" aria-label="Dental procedures">
            {settings.procedureTypes.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-32 font-mono text-meta">{t.code}</span>
                <span className="min-w-0 flex-1 font-medium">{t.name}</span>
                <span className="text-meta text-muted-foreground">
                  {PROCEDURE_SITES[t.site]}
                  {t.chartEffect ? ` · chart: ${EFFECTS[t.chartEffect].split(" (")[0]}` : ""}
                </span>
                {t.status === "inactive" ? <Badge variant="neutral">Inactive</Badge> : null}
                {canManage ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () => setProcedureTypeStatus(t.id, t.status === "active" ? "inactive" : "active", t.version),
                        t.status === "active" ? `${t.name} deactivated` : `${t.name} reactivated`,
                      )
                    }
                  >
                    {t.status === "active" ? "Deactivate" : "Reactivate"}
                  </Button>
                ) : null}
                <MayBecome type={t} types={settings.procedureTypes} canManage={canManage && t.status === "active"} />
              </li>
            ))}
          </ul>
          {settings.procedureTypes.length === 0 ? <p className="text-body text-muted-foreground">No procedures yet.</p> : null}
          {canManage ? (
            <form
              className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(
                  () => createProcedureType({ ...form, chartEffect: (form.chartEffect || null) as DentalChartEffect | null }),
                  `${form.name} added`,
                  () => setForm({ code: "", name: "", site: form.site, chartEffect: "" }),
                );
              }}
            >
              <p className="font-medium sm:col-span-2">
                <PlusIcon className="mr-1 inline size-4" aria-hidden /> Add a procedure
              </p>
              <Input
                aria-label="Code"
                placeholder="Code, e.g. composite-1s"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
              />
              <Input
                aria-label="Name"
                placeholder="Name, e.g. Composite restoration"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="procedure-site">Recorded against</Label>
                <NativeSelect
                  id="procedure-site"
                  value={form.site}
                  onChange={(e) => setForm({ ...form, site: e.target.value as DentalProcedureSite, chartEffect: "" })}
                >
                  {(Object.keys(PROCEDURE_SITES) as DentalProcedureSite[]).map((s) => (
                    <option key={s} value={s}>
                      {PROCEDURE_SITES[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="procedure-effect">Changes the chart to</Label>
                <NativeSelect
                  id="procedure-effect"
                  value={form.chartEffect}
                  disabled={form.site === "mouth"}
                  onChange={(e) => setForm({ ...form, chartEffect: e.target.value })}
                >
                  <option value="">Nothing</option>
                  {effects.map((effect) => (
                    <option key={effect} value={effect}>
                      {EFFECTS[effect]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" size="sm" className="self-end sm:col-span-2 sm:justify-self-start" disabled={pending}>
                Add procedure
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 self-start">
        <Card>
          <CardHeader>
            <CardTitle>Tooth notation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-body">
            <p className="text-meta text-muted-foreground">
              How teeth are numbered on screen{facility ? ` at ${facility.name}` : ""}. Records are always stored in FDI.
            </p>
            {facility && canManage ? (
              <NativeSelect
                aria-label="Tooth notation"
                value={settings.notation}
                disabled={pending}
                onChange={(e) => act(() => setNotation(facility.id, e.target.value as ToothNotation), "Notation changed")}
              >
                {(Object.keys(NOTATIONS) as ToothNotation[]).map((n) => (
                  <option key={n} value={n}>
                    {NOTATIONS[n]} — upper right first molar {toothLabel("16", n)}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <p>
                {NOTATIONS[settings.notation]} — upper right first molar {toothLabel("16", settings.notation)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dental records in MyHealth</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-body">
            {portal.portalDentalRecords ? (
              <Badge variant="info" className="w-fit">
                <SmartphoneIcon aria-hidden /> Shown to patients
              </Badge>
            ) : (
              <Badge variant="neutral" className="w-fit">
                <EyeOffIcon aria-hidden /> Not shown to patients
              </Badge>
            )}
            <p className="text-meta text-muted-foreground">
              For the whole organization. When on, patients with MyHealth access see their treatment plans (each item with the tooth, the procedure name, their
              decision and its status), the procedures done (date, tooth and surfaces, dentist, facility) and a plain-language summary of their current tooth
              chart.
            </p>
            <p className="text-meta text-muted-foreground">
              Never shown: examination and plan notes, tooth notes, decision notes, periodontal charts, procedure codes, and anything entered in error.
              Radiographs and photos are shown only when a dentist shares them one by one from the patient&apos;s dental record. Plans show fee estimates only
              if you turn them on under Fee estimates.
            </p>
            <p className="text-meta text-muted-foreground">
              While this is on, patients who use MyHealth get a message in MyHealth and by SMS (or email) when a dentist shares an image or a plan awaits their
              decision — naming no tooth, treatment or finding, only where to look. Their consent and communication preferences apply.
            </p>
            {portal.updatedAt ? (
              <p className="text-meta text-muted-foreground">
                Last changed {clinicalDateTime(portal.updatedAt)}
                {portal.updatedByName ? ` by ${portal.updatedByName}` : ""}
              </p>
            ) : null}
            {canManage ? (
              <Button
                size="sm"
                variant={portal.portalDentalRecords ? "outline" : "default"}
                className="self-start"
                disabled={pending}
                onClick={() =>
                  act(
                    () => setPortalDentalRecords(!portal.portalDentalRecords, portal.version),
                    portal.portalDentalRecords ? "Dental records hidden from MyHealth" : "Dental records shown in MyHealth",
                  )
                }
              >
                {portal.portalDentalRecords ? "Stop showing in MyHealth" : "Show in MyHealth"}
              </Button>
            ) : null}
          </CardContent>
        </Card>

        {portal.portalDentalRecords ? <PlanDecisions portal={portal} canManage={canManage} pending={pending} act={act} /> : null}
        <FeeEstimates portal={portal} canManage={canManage} pending={pending} act={act} />
      </div>
    </div>
  );
}

/**
 * Online plan decisions: patients accept or decline plan items awaiting their decision in MyHealth, after confirming
 * the organization's own text (the platform supplies no consent wording).
 */
/**
 * The procedures a procedure may turn out to be once under way (e.g. a simple extraction that becomes a surgical one):
 * estimates show the range of their listed prices, and a plan item may be carried out as any of them.
 */
function MayBecome({ type, types, canManage }: { type: DentalProcedureType; types: DentalProcedureType[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<string[] | null>(null);
  const name = (id: string) => types.find((t) => t.id === id)?.name ?? "Procedure";
  // Whole-mouth procedures only become whole-mouth ones; tooth procedures tooth ones.
  const candidates = types.filter((t) => t.id !== type.id && t.status === "active" && (t.site === "mouth") === (type.site === "mouth"));
  const save = (ids: string[]) =>
    startTransition(async () => {
      const result = await setProcedureAlternatives(type.id, ids);
      if (result.ok) {
        toast.success(ids.length ? `${type.name}: fee range set` : `${type.name}: single price`);
        setEditing(null);
        router.refresh();
      } else toast.error(result.message);
    });
  if (editing) {
    return (
      <div className="flex basis-full flex-col gap-1.5 rounded-md border p-2">
        <span className="text-meta">{type.name} may turn out to be:</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-meta">
              <Checkbox
                checked={editing.includes(c.id)}
                onCheckedChange={(checked) => setEditing(checked === true ? [...editing, c.id] : editing.filter((id) => id !== c.id))}
              />
              {c.name}
            </label>
          ))}
          {candidates.length === 0 ? <span className="text-meta text-muted-foreground">No other active procedure on the same site.</span> : null}
        </div>
        <div className="flex gap-1">
          <Button size="xs" disabled={pending} onClick={() => save(editing)}>
            Save
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  if (!type.alternativeIds.length && !canManage) return null;
  return (
    <span className="flex basis-full items-center gap-2 pl-32 text-meta text-muted-foreground">
      {type.alternativeIds.length ? `May turn out to be ${type.alternativeIds.map(name).join(" or ")} — estimates show a fee range` : null}
      {canManage ? (
        <Button size="xs" variant="ghost" onClick={() => setEditing([...type.alternativeIds])}>
          {type.alternativeIds.length ? "Change" : "May turn out to be…"}
        </Button>
      ) : null}
    </span>
  );
}

function PlanDecisions({
  portal,
  canManage,
  pending,
  act,
}: {
  portal: DentalPortalSetting;
  canManage: boolean;
  pending: boolean;
  act: (call: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) => void;
}) {
  const [text, setText] = React.useState(portal.portalPlanAcknowledgement ?? "");
  const save = (portalPlanDecisions: boolean, done: string) =>
    act(
      () =>
        setPortalPlanDecisions({
          portalDentalRecords: true,
          portalPlanDecisions,
          portalPlanAcknowledgement: text.trim() || null,
          version: portal.version,
        }),
      done,
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Treatment plan decisions in MyHealth</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        {portal.portalPlanDecisions ? (
          <Badge variant="info" className="w-fit">
            <SmartphoneIcon aria-hidden /> Patients can decide online
          </Badge>
        ) : (
          <Badge variant="neutral" className="w-fit">
            <EyeOffIcon aria-hidden /> Decisions taken at the clinic only
          </Badge>
        )}
        <p className="text-meta text-muted-foreground">
          When on, a patient can accept or decline the items of a plan awaiting their decision in MyHealth, after confirming the text below. The plan records
          that it was decided in MyHealth, with that text. Write it with your clinic&apos;s own consent practice in mind: the platform does not supply consent
          wording, and whether an online acknowledgement is enough for a given treatment is for your clinic to decide.
        </p>
        <label htmlFor="plan-acknowledgement" className="text-label font-medium">
          What the patient confirms
        </label>
        <Textarea
          id="plan-acknowledgement"
          rows={3}
          maxLength={1000}
          value={text}
          disabled={!canManage}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. I discussed this plan with my dentist and understand the options, risks and fees."
        />
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {portal.portalPlanDecisions ? (
              <>
                <Button size="sm" variant="outline" disabled={pending || text.trim().length < 20} onClick={() => save(true, "Acknowledgement saved")}>
                  Save text
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => save(false, "Plan decisions taken at the clinic only")}>
                  Stop online decisions
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={pending || text.trim().length < 20} onClick={() => save(true, "Patients can decide plans in MyHealth")}>
                Allow online decisions
              </Button>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Fee estimates on treatment plans: the organization's own note printed and shown under every estimate, and whether
 * MyHealth shows estimates (only while dental records are shown). Prices come from billing's price list.
 */
function FeeEstimates({
  portal,
  canManage,
  pending,
  act,
}: {
  portal: DentalPortalSetting;
  canManage: boolean;
  pending: boolean;
  act: (call: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) => void;
}) {
  const [note, setNote] = React.useState(portal.feeEstimateNote ?? "");
  const [validity, setValidity] = React.useState(portal.writtenEstimateValidityDays === null ? "" : String(portal.writtenEstimateValidityDays));
  const [writtenRequired, setWrittenRequired] = React.useState(portal.writtenEstimateRequired);
  const save = (portalPlanEstimates: boolean | undefined, done: string) =>
    act(
      () =>
        setFeeEstimates({
          portalDentalRecords: portal.portalDentalRecords,
          portalPlanEstimates,
          feeEstimateNote: note.trim() || null,
          writtenEstimateValidityDays: validity ? Number.parseInt(validity, 10) : null,
          writtenEstimateRequired: writtenRequired,
          version: portal.version,
        }),
      done,
    );
  const noteValid = note.trim().length === 0 || note.trim().length >= 10;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee estimates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        <p className="text-meta text-muted-foreground">
          An open treatment plan shows an estimate of the work still ahead at today&apos;s listed prices: the billing service mapped to each procedure code and
          its price (billing settings). Discounts, packages and HMO or PhilHealth coverage are not applied. Dentists print it for the patient from the plan, and
          each decision keeps the estimate the items had at the time.
        </p>
        <label htmlFor="fee-estimate-note" className="text-label font-medium">
          Your note under every estimate (optional)
        </label>
        <Textarea
          id="fee-estimate-note"
          rows={2}
          maxLength={500}
          value={note}
          disabled={!canManage}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Estimates hold for 30 days. Laboratory fees for crowns are charged separately."
        />
        <div className="grid gap-1">
          <label htmlFor="estimate-validity" className="text-label font-medium">
            Printed estimates hold for (days; optional)
          </label>
          <Input
            id="estimate-validity"
            inputMode="numeric"
            className="w-32"
            disabled={!canManage}
            value={validity}
            onChange={(e) => setValidity(e.target.value.replace(/\D/g, ""))}
          />
          <p className="text-meta text-muted-foreground">Printed as &ldquo;Valid until&rdquo; on the estimate. Leave empty to print no date.</p>
        </div>
        <label className="flex items-start gap-2 text-table">
          <Checkbox className="mt-1" disabled={!canManage} checked={writtenRequired} onCheckedChange={(checked) => setWrittenRequired(checked === true)} />
          <span>
            Require the patient&apos;s signed written estimate before recording a decision
            <span className="block text-meta text-muted-foreground">
              Staff record that the patient signed the printed estimate; a decision on items it did not list, or after it expired, is refused. Decisions
              patients make in MyHealth confirm your acknowledgement text instead.
            </span>
          </span>
        </label>
        {portal.portalDentalRecords ? (
          portal.portalPlanEstimates ? (
            <Badge variant="info" className="w-fit">
              <SmartphoneIcon aria-hidden /> Shown in MyHealth
            </Badge>
          ) : (
            <Badge variant="neutral" className="w-fit">
              <EyeOffIcon aria-hidden /> Not shown in MyHealth
            </Badge>
          )
        ) : (
          <p className="text-meta text-muted-foreground">Estimates can be shown in MyHealth once dental records are shown there.</p>
        )}
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending || !noteValid} onClick={() => save(undefined, "Estimate settings saved")}>
              Save estimate settings
            </Button>
            {portal.portalDentalRecords ? (
              <Button
                size="sm"
                variant={portal.portalPlanEstimates ? "outline" : "default"}
                disabled={pending || !noteValid}
                onClick={() => save(!portal.portalPlanEstimates, portal.portalPlanEstimates ? "Estimates hidden from MyHealth" : "Estimates shown in MyHealth")}
              >
                {portal.portalPlanEstimates ? "Stop showing in MyHealth" : "Show estimates in MyHealth"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
