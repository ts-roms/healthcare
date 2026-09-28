"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PackageIcon } from "lucide-react";
import type { ToothNotation } from "@healthcare/domain";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { DentalProcedure, DentalProcedureType, DentalSupplyOptions, DentalSupplyUse, DentalTreatmentPlan } from "@/lib/api/types";
import { markProcedureEnteredInError, recordProcedure } from "../../actions";
import { EnteredInError } from "./entered-in-error";
import { emptySelection, itemLabel, ProcedureFields, type ProcedureSelection, selectionComplete, selectionPayload } from "./procedure-fields";
import { ProcedureSupplies } from "./procedure-supplies";

/**
 * Procedures performed during the dental visit. A procedure that changes a tooth updates the chart; one carried out
 * from a plan completes the plan item; billing charges it from its code (dentistry sets no price). The supplies it used
 * are confirmed right after (prefilled from the procedure's template) and issued from stock.
 */
export function Procedures({
  patientId,
  procedures,
  types,
  plans,
  notation,
  encounterId,
  canRecord,
  canCorrect,
  supplyUses = [],
  supplyOptions = null,
}: {
  patientId: string;
  procedures: DentalProcedure[];
  types: DentalProcedureType[];
  plans: DentalTreatmentPlan[];
  notation: ToothNotation;
  encounterId: string | null;
  canRecord: boolean;
  canCorrect: boolean;
  supplyUses?: DentalSupplyUse[];
  supplyOptions?: DentalSupplyOptions | null;
}) {
  const router = useRouter();
  const [selection, setSelection] = React.useState<ProcedureSelection>(emptySelection);
  const [planItemId, setPlanItemId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [pending, startTransition] = React.useTransition();
  const [suppliesOf, setSuppliesOf] = React.useState<string | null>(null);
  const planned = plans
    .filter((p) => p.status === "accepted" || p.status === "in_progress")
    .flatMap((p) => p.items.filter((i) => i.status === "accepted").map((i) => ({ plan: p, item: i })));
  const type = types.find((t) => t.id === selection.procedureTypeId);

  const choosePlanned = (id: string) => {
    setPlanItemId(id);
    const found = planned.find((p) => p.item.id === id)?.item;
    if (found) setSelection({ procedureTypeId: found.procedureTypeId, tooth: found.tooth ?? "", surfaces: found.surfaces });
  };

  const submit = () =>
    startTransition(async () => {
      if (!encounterId) return;
      const result = await recordProcedure(
        patientId,
        { encounterId, ...selectionPayload(selection, type), notes: notes.trim() || undefined, planItemId: planItemId || undefined },
        key,
      );
      if (result.ok) {
        toast.success(`${result.data.label} recorded — confirm the supplies used`);
        setSuppliesOf(result.data.id);
        setSelection(emptySelection);
        setPlanItemId("");
        setNotes("");
        setKey(crypto.randomUUID());
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Procedures</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canRecord ? (
          encounterId ? (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              {planned.length ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="procedure-plan-item">From a treatment plan</Label>
                  <NativeSelect id="procedure-plan-item" value={planItemId} onChange={(e) => choosePlanned(e.target.value)}>
                    <option value="">Not from a plan</option>
                    {planned.map(({ plan, item }) => (
                      <option key={item.id} value={item.id}>
                        {plan.title} · phase {item.phase} · {itemLabel(item.procedure?.name ?? "Procedure", item.tooth, item.surfaces, notation)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              <ProcedureFields id="procedure" types={types} notation={notation} value={selection} onChange={setSelection} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                  <Label htmlFor="procedure-notes">Notes</Label>
                  <Input
                    id="procedure-notes"
                    value={notes}
                    maxLength={2000}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Material, anaesthesia, remarks"
                  />
                </div>
                <Button onClick={submit} disabled={pending || !selectionComplete(selection, type)}>
                  Record procedure
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-meta text-muted-foreground">Procedures are recorded during the patient&apos;s dental visit.</p>
          )
        ) : null}
        {procedures.length === 0 ? <p className="text-body text-muted-foreground">No procedures recorded.</p> : null}
        <ul className="divide-y text-table" aria-label="Procedures performed">
          {procedures.map((p) => {
            const error = p.status === "entered_in_error";
            const supplyCount = supplyUses.filter((u) => u.procedureId === p.id && u.kind === "issue").length;
            return (
              <li key={p.id} className="flex flex-col gap-2 py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular w-36 text-meta text-muted-foreground">{clinicalDateTime(p.performedAt)}</span>
                  <span className={error ? "min-w-0 flex-1 text-muted-foreground line-through" : "min-w-0 flex-1"}>
                    {itemLabel(p.procedure.name, p.tooth, p.surfaces, notation)}
                    {p.notes ? <span className="text-muted-foreground"> · {p.notes}</span> : null}
                    {p.planItemId ? <span className="text-muted-foreground"> · from plan</span> : null}
                  </span>
                  <span className="text-meta text-muted-foreground">{p.practitionerName}</span>
                  {error ? (
                    <Badge variant="neutral" title={p.enteredInErrorReason ?? undefined}>
                      Entered in error
                    </Badge>
                  ) : canCorrect ? (
                    <EnteredInError what="Procedure" onConfirm={(reason) => markProcedureEnteredInError(patientId, p.id, reason)} />
                  ) : null}
                  <Button size="xs" variant="ghost" aria-expanded={suppliesOf === p.id} onClick={() => setSuppliesOf(suppliesOf === p.id ? null : p.id)}>
                    <PackageIcon /> Supplies{supplyCount ? ` (${supplyCount})` : ""}
                  </Button>
                </div>
                {suppliesOf === p.id ? (
                  <ProcedureSupplies patientId={patientId} procedure={p} uses={supplyUses} options={supplyOptions} canRecord={canRecord} />
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
