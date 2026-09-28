"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EyeOffIcon, PlusIcon, SmartphoneIcon } from "lucide-react";
import { toothLabel, type ToothNotation } from "@healthcare/domain";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { DentalChartEffect, DentalPortalSetting, DentalProcedureSite, DentalSettings } from "@/lib/api/types";
import { PROCEDURE_SITES } from "@/lib/dental-mapping";
import { createProcedureType, setNotation, setPortalDentalRecords, setProcedureTypeStatus } from "../actions";

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
              Never shown: examination and plan notes, tooth notes, decision notes, periodontal charts, radiographs and photos, procedure codes, and anything
              entered in error. Plans carry no fees; patients are told to ask the clinic.
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
      </div>
    </div>
  );
}
