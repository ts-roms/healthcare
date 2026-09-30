"use client";

import * as React from "react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { LabReagentYield } from "@/lib/api/types";
import { setReagentYield } from "../quality-actions";
import { useRun } from "../quality-ui";

/** Tests one stock unit of each reagent holds; loads taken from stock get their capacity from it. */
export function YieldEditor({
  yields,
  reagents,
  canManage,
}: {
  yields: LabReagentYield[];
  /** Reagent items known to the laboratory (in stock or loaded), for setting a yield. */
  reagents: Array<{ itemId: string; itemName: string; stockUnit: string }>;
  canManage: boolean;
}) {
  const { pending, run } = useRun();
  const [editing, setEditing] = React.useState<{ itemId: string; tests: string } | null>(null);
  const unset = reagents.filter((r) => !yields.some((y) => y.inventoryItemId === r.itemId));
  const [adding, setAdding] = React.useState({ itemId: "", tests: "" });
  const save = (itemId: string, tests: string, after: () => void) =>
    run(() => setReagentYield({ itemId, testsPerUnit: Number.parseInt(tests, 10) }), "Yield saved", after);

  return (
    <div className="flex flex-col gap-3">
      {yields.length === 0 ? (
        <p className="text-table text-muted-foreground">No yield set. Without one, a load holds only the number of tests given when it is loaded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reagent</TableHead>
              <TableHead className="text-right">Tests per unit</TableHead>
              <TableHead>Set</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {yields.map((y) => (
              <TableRow key={y.inventoryItemId}>
                <TableCell>
                  {y.itemName} <span className="text-meta text-muted-foreground">· {y.itemCode}</span>
                </TableCell>
                <TableCell className="tabular text-right">
                  {editing?.itemId === y.inventoryItemId ? (
                    <form
                      className="inline-flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        save(y.inventoryItemId, editing.tests, () => setEditing(null));
                      }}
                    >
                      <Input
                        aria-label={`Tests per ${y.stockUnit}`}
                        inputMode="numeric"
                        className="h-7 w-24"
                        value={editing.tests}
                        onChange={(e) => setEditing({ ...editing, tests: e.target.value.replace(/\D/g, "") })}
                      />
                      <Button type="submit" size="xs" disabled={pending || !editing.tests}>
                        Save
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <>
                      {y.testsPerUnit} per {y.stockUnit}
                      {canManage ? (
                        <Button size="xs" variant="ghost" onClick={() => setEditing({ itemId: y.inventoryItemId, tests: String(y.testsPerUnit) })}>
                          Change
                        </Button>
                      ) : null}
                    </>
                  )}
                </TableCell>
                <TableCell className="text-meta text-muted-foreground">
                  {clinicalDate(y.updatedAt)} · {y.updatedByName}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canManage && unset.length > 0 ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(adding.itemId, adding.tests, () => setAdding({ itemId: "", tests: "" }));
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="yield-item">Reagent</Label>
            <NativeSelect
              placeholder="Choose a reagent…"
              id="yield-item"
              value={adding.itemId}
              onChange={(e) => setAdding({ ...adding, itemId: e.target.value })}
            >
              {unset.map((r) => (
                <option key={r.itemId} value={r.itemId}>
                  {r.itemName} ({r.stockUnit})
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="yield-tests">Tests per unit</Label>
            <Input
              id="yield-tests"
              inputMode="numeric"
              className="w-28"
              value={adding.tests}
              onChange={(e) => setAdding({ ...adding, tests: e.target.value.replace(/\D/g, "") })}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending || !adding.itemId || !adding.tests}>
            Set yield
          </Button>
        </form>
      ) : null}
      <p className="text-meta text-muted-foreground">
        As the manufacturer or the laboratory states it. A new yield applies to lots loaded from now on; loads keep the capacity they were given.
      </p>
    </div>
  );
}
