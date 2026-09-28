"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, CircleDotIcon, PackageIcon, PlusIcon, Undo2Icon, XIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { DentalSupplyOptions, DentalSupplyUse } from "@/lib/api/types";
import { procedureSupplies, type SupplyDraftLine, supplyDraft, supplyErrors, supplyLineState, supplyRequestLines } from "@/lib/dental-mapping";
import { recordSupplies, returnSupplies } from "../../actions";

const STATE_ICON = { used: CheckCircle2Icon, partial: CircleDotIcon, returned: Undo2Icon } as const;

/**
 * The supplies a procedure used: staff confirm the list (prefilled from the procedure's template), choose the stock
 * location, and the API issues them from inventory — first expiry first out, never from expired lots, all lines or
 * none. The lots issued are shown for traceability. Unused supplies go back only through an explicit return.
 */
export function ProcedureSupplies({
  patientId,
  procedure,
  uses,
  options,
  canRecord,
}: {
  patientId: string;
  procedure: { id: string; procedureTypeId: string; status: "recorded" | "entered_in_error" };
  uses: DentalSupplyUse[];
  options: DentalSupplyOptions | null;
  canRecord: boolean;
}) {
  const { uses: mine, returnable } = procedureSupplies(uses, procedure.id);
  const issued = mine.some((u) => u.kind === "issue");
  const canIssue = canRecord && procedure.status === "recorded" && options !== null && options.facilityId !== null;

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3" aria-label="Supplies used">
      <p className="flex items-center gap-1.5 font-medium">
        <PackageIcon className="size-4" aria-hidden /> Supplies used
      </p>
      {mine.length === 0 ? <p className="text-meta text-muted-foreground">No supplies recorded for this procedure.</p> : null}
      {mine.map((use) => (
        <div key={use.id} className="flex flex-col gap-1">
          <p className="text-meta text-muted-foreground">
            {use.kind === "issue" ? "Issued from" : "Returned to"} {use.locationName ?? "a stock location"} · {clinicalDateTime(use.recordedAt)}
            {use.recordedByName ? ` · ${use.recordedByName}` : ""}
            {use.reason ? ` · ${use.reason}` : ""}
          </p>
          <ul className="divide-y text-table">
            {use.lines.map((line) => {
              const state = use.kind === "issue" ? supplyLineState(line) : null;
              const Icon = state ? STATE_ICON[state.kind] : Undo2Icon;
              return (
                <li key={line.id} className="flex flex-wrap items-center gap-2 py-1">
                  <span className="min-w-0 flex-1">
                    {line.itemName}{" "}
                    <span className="tabular-nums">
                      × {line.quantity} {line.stockUnit}
                    </span>
                  </span>
                  <span className="font-mono text-meta">
                    {line.lotNumber ? `Lot ${line.lotNumber}` : "No lot"}
                    {line.expiryDate ? ` · exp. ${line.expiryDate}` : ""}
                  </span>
                  <Badge variant={state?.variant ?? "neutral"}>
                    <Icon aria-hidden /> {state?.label ?? "Returned to stock"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {canIssue && options ? (
        <IssueForm
          key={issued ? "more" : "first"}
          patientId={patientId}
          procedureId={procedure.id}
          options={options}
          initial={issued ? [] : supplyDraft(options, procedure.procedureTypeId)}
          more={issued}
        />
      ) : canRecord && procedure.status === "recorded" && !options?.facilityId ? (
        <p className="text-meta text-muted-foreground">Select your facility to record supplies from its stock.</p>
      ) : null}
      {canRecord && returnable.length ? <ReturnForm patientId={patientId} procedureId={procedure.id} lines={returnable} /> : null}
    </div>
  );
}

function IssueForm({
  patientId,
  procedureId,
  options,
  initial,
  more,
}: {
  patientId: string;
  procedureId: string;
  options: DentalSupplyOptions;
  initial: SupplyDraftLine[];
  more: boolean;
}) {
  const router = useRouter();
  const [locationId, setLocationId] = React.useState(options.defaultLocationId ?? options.locations[0]?.id ?? "");
  const [lines, setLines] = React.useState<SupplyDraftLine[]>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [pending, startTransition] = React.useTransition();
  const itemById = new Map(options.items.map((i) => [i.id, i]));
  const update = (index: number, change: Partial<SupplyDraftLine>) => {
    setLines((list) => list.map((l, i) => (i === index ? { ...l, ...change } : l)));
    setKey(crypto.randomUUID());
  };

  const submit = () =>
    startTransition(async () => {
      setErrors({});
      setFormError(null);
      const result = await recordSupplies(patientId, procedureId, { locationId, lines: supplyRequestLines(lines), idempotencyKey: key });
      if (result.ok) {
        toast.success("Supplies issued from stock");
        setLines([]);
        setKey(crypto.randomUUID());
        router.refresh();
      } else {
        const inline = supplyErrors(result.code, result.message, result.details);
        setErrors(inline);
        setFormError(Object.keys(inline).length ? "Nothing was issued. Check the supplies marked below." : `Nothing was issued: ${result.message}`);
      }
    });

  if (options.locations.length === 0) {
    return <p className="text-meta text-muted-foreground">This facility has no active stock location. Inventory staff can add one.</p>;
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-meta font-medium">{more ? "Record more supplies used" : "Confirm the supplies used"}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`supply-location-${procedureId}`}>Taken from</Label>
        <NativeSelect
          id={`supply-location-${procedureId}`}
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setKey(crypto.randomUUID());
          }}
        >
          {options.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {lines.map((line, index) => {
        const item = itemById.get(line.itemId);
        const usable = item ? (item.usable[locationId] ?? 0) : 0;
        const error = errors[line.itemId];
        return (
          <div key={index} className="flex flex-col gap-1 rounded-md border bg-background p-2">
            <div className="flex flex-wrap items-end gap-2">
              <NativeSelect
                aria-label={`Supply ${index + 1}`}
                className="min-w-56 flex-1"
                value={line.itemId}
                onChange={(e) => update(index, { itemId: e.target.value })}
              >
                <option value="">Choose a supply…</option>
                {options.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.controlled ? " (controlled)" : ""}
                  </option>
                ))}
              </NativeSelect>
              <Input
                aria-label={`Quantity of supply ${index + 1}`}
                type="number"
                min={1}
                max={1000}
                className="w-24"
                value={line.quantity}
                onChange={(e) => update(index, { quantity: Number(e.target.value) })}
              />
              <span className="text-meta text-muted-foreground">{item ? `${item.stockUnit} · ${usable} usable here` : ""}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove supply ${index + 1}`}
                onClick={() => setLines((list) => list.filter((_, i) => i !== index))}
              >
                <XIcon />
              </Button>
            </div>
            {item?.controlled ? (
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label={`Reason for ${item.name}`}
                  placeholder="Reason (controlled item)"
                  className="min-w-48 flex-1"
                  value={line.reason}
                  onChange={(e) => update(index, { reason: e.target.value })}
                />
                <Input
                  aria-label={`Reference for ${item.name}`}
                  placeholder="Reference (e.g. register entry)"
                  className="w-56"
                  value={line.reference}
                  onChange={(e) => update(index, { reference: e.target.value })}
                />
              </div>
            ) : null}
            {error ? (
              <p className="flex items-center gap-1 text-meta text-danger-foreground" role="alert">
                <XIcon className="size-3.5" aria-hidden /> {error}
              </p>
            ) : null}
          </div>
        );
      })}
      {lines.length === 0 && !more ? <p className="text-meta text-muted-foreground">No template for this procedure — add what was used.</p> : null}
      {formError ? (
        <p className="text-meta text-danger-foreground" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setLines((list) => [...list, { itemId: "", quantity: 1, reason: "", reference: "" }])}>
          <PlusIcon /> Add supply
        </Button>
        <Button size="sm" onClick={submit} disabled={pending || !locationId || lines.length === 0 || lines.some((l) => !l.itemId || l.quantity < 1)}>
          Issue from stock
        </Button>
      </div>
    </div>
  );
}

function ReturnForm({
  patientId,
  procedureId,
  lines,
}: {
  patientId: string;
  procedureId: string;
  lines: Array<DentalSupplyUse["lines"][number] & { useId: string; locationId: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [reason, setReason] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [pending, startTransition] = React.useTransition();
  if (!open) {
    return (
      <Button size="xs" variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        <Undo2Icon /> Return unused supplies…
      </Button>
    );
  }
  const chosen = Object.entries(quantities)
    .filter(([, q]) => q > 0)
    .map(([lineId, quantity]) => ({ lineId, quantity }));
  const submit = () =>
    startTransition(async () => {
      const result = await returnSupplies(patientId, procedureId, {
        lines: chosen,
        reason,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        idempotencyKey: key,
      });
      if (result.ok) {
        toast.success("Unused supplies returned to stock");
        setOpen(false);
        setQuantities({});
        setReason("");
        setReference("");
        setKey(crypto.randomUUID());
        router.refresh();
      } else toast.error(`Nothing was returned: ${result.message}`);
    });
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-meta font-medium">Return unused supplies to the lot they came from</p>
      {lines.map((line) => (
        <div key={line.id} className="flex flex-wrap items-center gap-2 text-table">
          <span className="min-w-0 flex-1">
            {line.itemName} · <span className="font-mono text-meta">{line.lotNumber ? `Lot ${line.lotNumber}` : "No lot"}</span>
          </span>
          <Input
            aria-label={`Quantity of ${line.itemName} to return`}
            type="number"
            min={0}
            max={line.outstanding ?? 0}
            className="w-20"
            value={quantities[line.id] ?? 0}
            onChange={(e) => {
              setQuantities((q) => ({ ...q, [line.id]: Number(e.target.value) }));
              setKey(crypto.randomUUID());
            }}
          />
          <span className="text-meta text-muted-foreground">of {line.outstanding}</span>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Why are they returned?"
          placeholder="Reason (e.g. not opened)"
          className="min-w-56 flex-1"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Input
          aria-label="Reference"
          placeholder="Reference (controlled items)"
          className="w-56"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending || chosen.length === 0 || reason.trim().length < 3}>
          Return to stock
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
