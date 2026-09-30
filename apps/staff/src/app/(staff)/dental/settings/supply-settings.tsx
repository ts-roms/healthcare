"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, NativeSelect, toast } from "@healthcare/ui/primitives";
import { SupplyTemplates } from "@/components/supply-templates";
import type { DentalProcedureType, DentalSupplyOptions } from "@/lib/api/types";
import { setSupplyLocation, setSupplyTemplate } from "../actions";

/**
 * Supply templates: the inventory items and quantities a procedure usually uses. Configuration only — staff confirm
 * (and change) what was used after each procedure, and it is issued from the facility's stock then.
 */
export function SupplySettings({
  options,
  procedureTypes,
  facility,
  canManage,
}: {
  options: DentalSupplyOptions;
  procedureTypes: DentalProcedureType[];
  facility: { id: string; name: string } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

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
    <div className="grid gap-4 px-4 pb-4 xl:grid-cols-[2fr_1fr]">
      <SupplyTemplates
        options={options}
        procedures={procedureTypes}
        templateOf={(id) => options.templates.find((t) => t.procedureTypeId === id)?.items ?? []}
        canManage={canManage}
        onSave={setSupplyTemplate}
      />

      <Card className="self-start">
        <CardHeader>
          <CardTitle>Supplies taken from</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-body">
          <p className="text-meta text-muted-foreground">
            The stock location offered first when recording supplies{facility ? ` at ${facility.name}` : ""}. Staff can choose another.
          </p>
          {!facility ? (
            <p className="text-meta text-muted-foreground">Select your facility to set its default.</p>
          ) : options.locations.length === 0 ? (
            <p className="text-meta text-muted-foreground">This facility has no active stock location.</p>
          ) : canManage ? (
            <NativeSelect
              emptyText="No stock locations set up"
              aria-label="Default stock location for dental supplies"
              value={options.defaultLocationId ?? ""}
              disabled={pending}
              onChange={(e) => act(() => setSupplyLocation(facility.id, e.target.value || null), "Default location saved")}
            >
              <option value="">No default</option>
              {options.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p>{options.locations.find((l) => l.id === options.defaultLocationId)?.name ?? "No default"}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
