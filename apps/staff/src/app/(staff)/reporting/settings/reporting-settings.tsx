"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, ClockIcon, LoaderIcon, PlusIcon, RefreshCwIcon, SearchCheckIcon, TriangleAlertIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import type { DohFacilityCode, DohRescan, DohRescanStatus, ReportableRule } from "@/lib/api/types";
import { createRule, deactivateRule, recordFacilityCode, requestRescan } from "../actions";

function useSubmit() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const submit = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });
  return { pending, submit };
}

export function ReportingSettings({
  rules,
  rescans,
  today,
  timeZone,
  facility,
}: {
  rules: ReportableRule[];
  rescans: DohRescan[];
  /** Today's date in the time zone the check uses (the selected facility's). */
  today: string;
  /** The selected facility's time zone: the check reads its calendar dates there. */
  timeZone: string;
  facility: { id: string; name: string; code: DohFacilityCode | null } | null;
}) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
      <Rules rules={rules} />
      <div className="flex flex-col gap-4">
        {facility ? <FacilityCode facility={facility} /> : null}
        <EarlierDiagnoses rescans={rescans} today={today} timeZone={timeZone} hasActiveRules={rules.some((r) => r.status === "active")} />
      </div>
    </div>
  );
}

function Rules({ rules }: { rules: ReportableRule[] }) {
  const { pending, submit } = useSubmit();
  const empty = { codePrefix: "", category: "", sourceNote: "" };
  const [f, setF] = React.useState(empty);
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Rules</CardTitle>
        <p className="text-meta text-muted-foreground">
          An ICD-10 code or prefix (A9 covers A90–A99; A91 covers A91 and A91.x). Nothing is reportable until you add it here — take the list and categories
          from the official issuances your facility follows.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {rules.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.codePrefix}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell className="text-muted-foreground">{r.sourceNote ?? "—"}</TableCell>
                  <TableCell>{clinicalDate(r.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {r.status === "active" ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={pending}
                        onClick={() => submit(() => deactivateRule({ ruleId: r.id }), "Rule deactivated")}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Badge variant="neutral">Inactive</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-4 text-body text-muted-foreground">No reportable conditions configured.</p>
        )}
        <form
          className="grid gap-2 px-4 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end"
          aria-label="Add a reportable condition"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () => createRule({ ...f, sourceNote: f.sourceNote || undefined }),
              `${f.codePrefix.toUpperCase()} added`,
              () => setF(empty),
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-code">ICD-10 code</Label>
            <Input id="rule-code" value={f.codePrefix} maxLength={8} onChange={(e) => setF({ ...f, codePrefix: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-category">Category</Label>
            <Input id="rule-category" value={f.category} maxLength={120} onChange={(e) => setF({ ...f, category: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-source">Source (issuance)</Label>
            <Input id="rule-source" value={f.sourceNote} maxLength={500} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            <PlusIcon /> Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function FacilityCode({ facility }: { facility: { id: string; name: string; code: DohFacilityCode | null } }) {
  const { pending, submit } = useSubmit();
  const [code, setCode] = React.useState(facility.code?.facilityCode ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle>DOH health facility code</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        <p className="text-meta text-muted-foreground">{facility.name}. As issued by DOH; used on case reports. Not verified with DOH.</p>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => recordFacilityCode({ facilityId: facility.id, facilityCode: code, version: facility.code?.version }), "Facility code saved");
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="doh-facility-code">Facility code</Label>
            <Input id="doh-facility-code" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Longest range the API accepts for one check (calendar days, both ends included). */
const MAX_RESCAN_DAYS = 90;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const RESCAN_STATUS: Record<DohRescanStatus, { label: string; variant: "info" | "success" | "danger"; icon: typeof ClockIcon }> = {
  queued: { label: "Waiting", variant: "info", icon: ClockIcon },
  running: { label: "Checking", variant: "info", icon: LoaderIcon },
  completed: { label: "Done", variant: "success", icon: CheckCircle2Icon },
  failed: { label: "Failed", variant: "danger", icon: TriangleAlertIcon },
};

/** Rules added later do not reach diagnoses recorded before them: staff can ask for a range to be checked. */
/** How often the page refreshes while a check is waiting or running. */
const RESCAN_REFRESH_MS = 5_000;

function EarlierDiagnoses({ rescans, today, timeZone, hasActiveRules }: { rescans: DohRescan[]; today: string; timeZone: string; hasActiveRules: boolean }) {
  const router = useRouter();
  const { pending, submit } = useSubmit();
  const [range, setRange] = React.useState({ from: addDays(today, -29), to: today });
  const inProgress = rescans.some((r) => r.status === "queued" || r.status === "running");
  // Follow a check while it runs; stops by itself once none is waiting or running.
  React.useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => router.refresh(), RESCAN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [inProgress, router]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Check earlier diagnoses</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-body">
        <p className="text-meta text-muted-foreground">
          Rules apply to diagnoses as they are recorded. After adding a rule, check diagnoses recorded before it (up to {MAX_RESCAN_DAYS} days at a time)
          against the active rules. Matches open case reports for review; a diagnosis never gets a second one. Dates are read in {timeZone}.
        </p>
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          aria-label="Check earlier diagnoses"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => requestRescan(range), "Check started — it runs in the background");
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="rescan-from">Recorded from</Label>
            <Input
              id="rescan-from"
              type="date"
              value={range.from}
              min={addDays(range.to, -(MAX_RESCAN_DAYS - 1))}
              max={range.to}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rescan-to">to</Label>
            <Input id="rescan-to" type="date" value={range.to} min={range.from} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
          <Button type="submit" size="sm" disabled={pending || inProgress || !hasActiveRules}>
            <SearchCheckIcon /> Check
          </Button>
        </form>
        {!hasActiveRules ? <p className="text-meta text-muted-foreground">Add a rule first.</p> : null}
        {rescans.length ? (
          <ul className="flex flex-col divide-y" aria-label="Recent checks">
            {rescans.map((r) => {
              const { label, variant, icon: Icon } = RESCAN_STATUS[r.status];
              return (
                <li key={r.id} className="flex flex-col gap-1 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {clinicalDate(r.fromDate)} – {clinicalDate(r.toDate)}
                    </span>
                    <Badge variant={variant}>
                      <Icon aria-hidden /> {label}
                    </Badge>
                  </div>
                  <span className="text-meta text-muted-foreground">
                    {r.scanned} coded diagnoses checked · {r.matched} matched a rule · {r.opened} case {r.opened === 1 ? "report" : "reports"} opened
                  </span>
                  {r.status === "failed" && r.lastError ? <span className="text-meta text-danger-foreground">{r.lastError}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {inProgress ? (
          <p className="flex items-center gap-2 text-meta text-muted-foreground" role="status">
            <RefreshCwIcon aria-hidden className="size-3.5" /> Updating every few seconds while the check runs.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
