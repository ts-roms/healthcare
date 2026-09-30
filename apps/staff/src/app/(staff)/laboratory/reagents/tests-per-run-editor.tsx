"use client";

import * as React from "react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { LabReagentTestsPerRun } from "@/lib/api/types";
import { setReagentTestsPerRun } from "../quality-actions";
import { useRun } from "../quality-ui";

/**
 * Tests one run of a test uses from a reagent, where more than 1 (duplicates, dilutions, blanks). Quality managers set
 * them; 1 is the default, so "Use 1" removes a setting. Runs already counted keep their count.
 */
export function TestsPerRunEditor({
  settings,
  reagents,
  tests,
  canManage,
}: {
  settings: LabReagentTestsPerRun[];
  reagents: Array<{ itemId: string; itemName: string; stockUnit: string }>;
  tests: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const { pending, run } = useRun();
  const blank = { itemId: "", testId: "", testsPerRun: "2" };
  const [form, setForm] = React.useState(blank);
  const save = (itemId: string, testId: string, testsPerRun: number, done: string, after?: () => void) =>
    run(() => setReagentTestsPerRun({ itemId, testId, testsPerRun }), done, after);

  return (
    <div className="flex flex-col gap-3">
      {settings.length === 0 ? (
        <p className="text-table text-muted-foreground">Every run uses one test of each reagent lot in use.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reagent</TableHead>
              <TableHead>Test</TableHead>
              <TableHead className="text-right">Tests per run</TableHead>
              <TableHead>Set</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.map((s) => (
              <TableRow key={`${s.inventoryItemId}:${s.testId}`}>
                <TableCell>
                  {s.itemName} <span className="text-meta text-muted-foreground">· {s.itemCode}</span>
                </TableCell>
                <TableCell>{s.testName}</TableCell>
                <TableCell className="tabular text-right">{s.testsPerRun}</TableCell>
                <TableCell className="text-meta text-muted-foreground">
                  {clinicalDate(s.updatedAt)} · {s.updatedByName}
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => save(s.inventoryItemId, s.testId, 1, `${s.testName} uses 1 test per run of ${s.itemName}`)}
                    >
                      Use 1
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canManage && reagents.length > 0 && tests.length > 0 ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(form.itemId, form.testId, Number.parseInt(form.testsPerRun, 10), "Tests per run saved", () => setForm(blank));
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="per-run-item">Reagent</Label>
            <NativeSelect placeholder="Choose a reagent…" id="per-run-item" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
              {reagents.map((r) => (
                <option key={r.itemId} value={r.itemId}>
                  {r.itemName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="per-run-test">Test</Label>
            <NativeSelect placeholder="Choose a test…" id="per-run-test" value={form.testId} onChange={(e) => setForm({ ...form, testId: e.target.value })}>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="per-run-tests">Tests per run</Label>
            <Input
              id="per-run-tests"
              inputMode="numeric"
              className="w-20"
              value={form.testsPerRun}
              onChange={(e) => setForm({ ...form, testsPerRun: e.target.value.replace(/\D/g, "") })}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending || !form.itemId || !form.testId || !form.testsPerRun}>
            Set
          </Button>
        </form>
      ) : null}
      <p className="text-meta text-muted-foreground">
        For a test run in duplicate, or with a dilution or a blank. QC runs and re-runs count their test&apos;s tests per run; the first run of an order counts
        once on each lot, with the most tests per run among the ordered tests that lot serves. A change applies to runs from now on.
      </p>
    </div>
  );
}
