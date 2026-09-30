import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabAvailableReagentLot, LabReagentTestsPerRun, LabReagentUsage, LabReagentYield, LabTest } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { shiftDate, todayIn } from "@/lib/clinic-mapping";
import { percent, reagentUseText, runsText } from "@/lib/lab-mapping";
import { TestsPerRunEditor } from "./tests-per-run-editor";
import { YieldEditor } from "./yield-editor";

export const metadata = { title: "Reagent use" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (date: string) => clinicalDate(`${date}T12:00:00Z`);

/** Reagent use per test run: loads in use in a period, runs by kind, what is left, and the reagent cost per patient run. */
export default async function ReagentUsePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Reagent use" />
        <FacilityRequired action="Reagent lots are loaded on a facility's instruments." />
      </>
    );
  }
  const today = todayIn(facility.timezone);
  const to = params.to && DATE.test(params.to) ? params.to : today;
  const from = params.from && DATE.test(params.from) && params.from <= to ? params.from : shiftDate(to, -29);
  const canManage = can(session, "lab.qc.manage");
  const [usage, yields, available, perRun, tests] = await Promise.all([
    api<LabReagentUsage>("/laboratory/reagents/usage", { query: { from, to } }),
    api<LabReagentYield[]>("/laboratory/reagents/yields"),
    canManage ? api<LabAvailableReagentLot[]>("/laboratory/reagents/available") : Promise.resolve([]),
    api<LabReagentTestsPerRun[]>("/laboratory/reagents/tests-per-run"),
    canManage ? api<LabTest[]>("/laboratory/tests") : Promise.resolve([]),
  ]);
  const reagents = new Map<string, { itemId: string; itemName: string; stockUnit: string }>();
  for (const l of available) reagents.set(l.itemId, { itemId: l.itemId, itemName: l.itemName, stockUnit: l.stockUnit });
  for (const y of yields) reagents.set(y.inventoryItemId, { itemId: y.inventoryItemId, itemName: y.itemName, stockUnit: y.stockUnit });
  const period = usage.reagents.reduce(
    (n, r) => ({
      patient: n.patient + r.patientRuns,
      patientTests: n.patientTests + r.patientTests,
      other: n.other + r.total - r.patientTests,
      total: n.total + r.total,
    }),
    { patient: 0, patientTests: 0, other: 0, total: 0 },
  );
  const low = usage.loads.filter((l) => l.use.low);

  return (
    <>
      <PageHeader
        title="Reagent use"
        description={`${facility.name} · every patient run, QC run and recorded use counted against the reagent lot loaded on the instrument. Stock leaves inventory when a lot is loaded; runs never move stock.`}
      />
      <div className="flex flex-col gap-4 p-4">
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Period">
          <div className="grid gap-1">
            <Label htmlFor="use-from">From</Label>
            <DateInput id="use-from" name="from" defaultValue={from} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="use-to">To</Label>
            <DateInput id="use-to" name="to" defaultValue={to} className="w-40" />
          </div>
          <Button type="submit" size="sm">
            Apply
          </Button>
        </form>

        <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure label="Patient runs" value={period.patient.toLocaleString("en-PH")}>
            {day(from)} to {day(to)}
            {period.patientTests !== period.patient ? ` · ${period.patientTests.toLocaleString("en-PH")} tests` : ""}
          </Figure>
          <Figure label="QC, repeats, calibration, waste" value={period.other.toLocaleString("en-PH")}>
            {percent(period.total ? period.other / period.total : null)} of all tests used
          </Figure>
          <Figure label="Lots in use in the period" value={String(usage.loads.length)}>
            {usage.loads.filter((l) => !l.unloadedAt).length} still loaded
          </Figure>
          <Figure label="Running low" value={String(low.length)}>
            loaded lots with a tenth of their tests or less left
          </Figure>
        </section>

        {low.length > 0 ? (
          <p className="flex items-center gap-1.5 text-table text-warning-foreground" role="status">
            <TriangleAlertIcon className="size-4" aria-hidden />
            Running low: {low.map((l) => `${l.itemName} lot ${l.lotNumber ?? "—"} on ${l.instrumentName} (${l.use.remaining} left)`).join("; ")}.
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>By reagent</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleTable
              empty="No reagent lot was in use in this period."
              head={["Reagent", "Lots", "Patient runs", "QC runs", "Other", "Wasted", "Tests used", "Not patient runs"]}
              rows={usage.reagents.map((r) => [
                <span key="r">
                  {r.itemName} <span className="text-meta text-muted-foreground">· {r.itemCode}</span>
                </span>,
                r.loads,
                runsText(r.patientRuns, r.patientTests),
                runsText(r.qcRuns, r.qcTests),
                r.otherRuns,
                r.wasted,
                r.total,
                percent(r.nonPatientShare),
              ])}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lots in use</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <SimpleTable
              empty="No reagent lot was in use in this period."
              head={["Lot", "In this period", "Over its life", "Stock cost", "Per patient run"]}
              rows={usage.loads.map((l) => [
                <span key="l" className="flex flex-col">
                  <span>
                    {l.itemName} · lot {l.lotNumber ?? "—"}{" "}
                    {l.use.low ? (
                      <Badge variant="warning">
                        <TriangleAlertIcon aria-hidden /> Running low
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-meta text-muted-foreground">
                    {l.instrumentName} · {l.testName ?? "all tests"} · loaded {clinicalDateTime(l.loadedAt)}
                    {l.unloadedAt ? ` · unloaded ${clinicalDateTime(l.unloadedAt)}` : " · in use"}
                  </span>
                </span>,
                <span key="p" className="flex flex-col">
                  <span>{l.period.total} tests</span>
                  <span className="text-meta text-muted-foreground">
                    patient {runsText(l.period.patientRuns, l.period.patientTests)} · QC {runsText(l.period.qcRuns, l.period.qcTests)} · other{" "}
                    {l.period.otherRuns} · wasted {l.period.wasted}
                  </span>
                </span>,
                <span key="u" className="flex flex-col">
                  <span>{reagentUseText(l.use)}</span>
                  {l.unusedAtUnload ? <span className="text-meta text-muted-foreground">{l.unusedAtUnload} unused when unloaded</span> : null}
                </span>,
                l.stockCost === null ? "—" : peso(l.stockCost),
                l.costPerPatientRun === null ? "—" : peso(l.costPerPatientRun),
              ])}
            />
            <p className="text-meta text-muted-foreground">
              A patient run is an order measured on the instrument: the tests of one order entered together count once, and a correction entered on the
              instrument is a re-run. A run uses one test of each lot unless a test is set to use more (tests per run below): a panel&apos;s first run counts
              the most of its tests. The cost per patient run spreads what the lot&apos;s stock cost — QC, repeats, calibration, waste and what was left unused
              included — over its patient runs, once the lot is unloaded. Operational figures, not an accounting valuation. Record repeats, calibration and
              waste on the{" "}
              <Link href="/laboratory/instruments" className="text-primary hover:underline">
                instruments
              </Link>{" "}
              page.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tests per unit</CardTitle>
          </CardHeader>
          <CardContent>
            <YieldEditor yields={yields} reagents={[...reagents.values()]} canManage={canManage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tests per run</CardTitle>
          </CardHeader>
          <CardContent>
            <TestsPerRunEditor
              settings={perRun}
              reagents={[...reagents.values()]}
              tests={tests.filter((t) => t.status === "active").map((t) => ({ id: t.id, name: t.name }))}
              canManage={canManage}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Figure({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <Card className="p-3">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="tabular text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-meta text-muted-foreground">{children}</p>
    </Card>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-table text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h, i) => (
            <TableHead key={h} className={i === 0 ? undefined : "text-right"}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, r) => (
          <TableRow key={r}>
            {row.map((cell, i) => (
              <TableCell key={i} className={i === 0 ? undefined : "tabular text-right"}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
