"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BuildingIcon, CircleCheckIcon, CirclePauseIcon, PlusIcon, TruckIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import type { LabTest, LabTestReferral, ReferenceLaboratory } from "@/lib/api/types";
import { formatDuration } from "@/lib/lab-mapping";
import { createReferenceLab, removeTestReferral, setReferenceLabStatus, setTestReferral } from "../actions";

type Run = (call: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) => void;

function useRun(): { pending: boolean; run: Run } {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run: Run = (call, success, after) =>
    start(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong.");
    });
  return { pending, run };
}

/**
 * Reference laboratories the organization sends tests to, and the tests this facility refers out. The accreditation /
 * licence reference is recorded as staff give it; the platform does not verify it.
 */
export function ReferenceLabSettings({
  referenceLabs,
  referrals,
  tests,
  facilityName,
  canManage,
}: {
  referenceLabs: ReferenceLaboratory[];
  referrals: LabTestReferral[] | null;
  tests: LabTest[];
  facilityName: string | null;
  canManage: boolean;
}) {
  const active = referenceLabs.filter((l) => l.status === "active");
  return (
    <Card id="reference-laboratories">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BuildingIcon className="size-4" aria-hidden /> Reference laboratories
        </CardTitle>
        <p className="text-meta text-muted-foreground">
          External laboratories that perform tests this organization refers out. Their results are entered here and signed off like in-house results, marked
          &ldquo;Performed by&rdquo; the reference laboratory. Accreditation and licence references are recorded as given — not verified.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {referenceLabs.length === 0 ? (
          <p className="text-table text-muted-foreground">No reference laboratories yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Laboratory</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Accreditation / licence (as recorded)</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead className="w-32" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {referenceLabs.map((lab) => (
                <ReferenceLabRow key={lab.id} lab={lab} canManage={canManage} />
              ))}
            </TableBody>
          </Table>
        )}
        {canManage ? <NewReferenceLab /> : null}

        <section aria-labelledby="referrals-heading" className="flex flex-col gap-2 border-t pt-3">
          <h3 id="referrals-heading" className="flex items-center gap-1.5 text-table font-semibold">
            <TruckIcon className="size-4" aria-hidden /> Tests referred out{facilityName ? ` from ${facilityName}` : ""}
          </h3>
          {referrals === null ? (
            <p className="text-table text-muted-foreground">Select a facility to see which tests its laboratory refers out.</p>
          ) : (
            <>
              <p className="text-meta text-muted-foreground">
                When a specimen for one of these tests is received, a send-out is prepared for the reference laboratory. Turnaround counts from dispatch.
              </p>
              {referrals.length === 0 ? (
                <p className="text-table text-muted-foreground">This facility performs every test itself.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Test</TableHead>
                      <TableHead>Reference laboratory</TableHead>
                      <TableHead>Expected turnaround</TableHead>
                      {canManage ? <TableHead className="w-40" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrals.map((r) => (
                      <ReferralRow key={r.testId} referral={r} canManage={canManage} />
                    ))}
                  </TableBody>
                </Table>
              )}
              {canManage && active.length ? (
                <NewReferral tests={tests.filter((t) => t.status === "active")} referenceLabs={active} referrals={referrals} />
              ) : null}
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function ReferenceLabRow({ lab, canManage }: { lab: ReferenceLaboratory; canManage: boolean }) {
  const { pending, run } = useRun();
  const next = lab.status === "active" ? "inactive" : "active";
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{lab.name}</span>
        <span className="block font-mono text-meta text-muted-foreground">{lab.code}</span>
      </TableCell>
      <TableCell className="text-table">
        {[lab.contactName, lab.phone, lab.email].filter(Boolean).join(" · ") || "—"}
        {lab.address ? <span className="block text-meta text-muted-foreground">{lab.address}</span> : null}
      </TableCell>
      <TableCell className="text-table">{lab.accreditationReference ?? "—"}</TableCell>
      <TableCell>
        {lab.status === "active" ? (
          <Badge variant="success">
            <CircleCheckIcon aria-hidden /> Active
          </Badge>
        ) : (
          <Badge variant="neutral">
            <CirclePauseIcon aria-hidden /> Inactive
          </Badge>
        )}
      </TableCell>
      {canManage ? (
        <TableCell className="text-right">
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => setReferenceLabStatus({ id: lab.id, status: next, version: lab.version }), `${lab.name}: ${next}`)}
          >
            {next === "inactive" ? "Deactivate" : "Activate"}
          </Button>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function NewReferenceLab() {
  const { pending, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const empty = { code: "", name: "", contactName: "", phone: "", email: "", address: "", accreditationReference: "" };
  const [form, setForm] = React.useState(empty);
  const field = (key: keyof typeof empty, label: string, max: number) => (
    <div className="grid gap-1">
      <Label htmlFor={`reflab-${key}`}>{label}</Label>
      <Input id={`reflab-${key}`} value={form[key]} maxLength={max} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
    </div>
  );
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <PlusIcon /> Add reference laboratory
      </Button>
    );
  }
  return (
    <form
      className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createReferenceLab(form),
          `${form.name}: added`,
          () => {
            setForm(empty);
            setOpen(false);
          },
        );
      }}
    >
      {field("code", "Code *", 49)}
      {field("name", "Name *", 160)}
      {field("accreditationReference", "Accreditation / licence reference", 120)}
      {field("contactName", "Contact person", 160)}
      {field("phone", "Phone", 40)}
      {field("email", "Email", 200)}
      <div className="sm:col-span-2">{field("address", "Address", 500)}</div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending || !form.code.trim() || !form.name.trim()}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReferralRow({ referral, canManage }: { referral: LabTestReferral; canManage: boolean }) {
  const { pending, run } = useRun();
  const [removing, setRemoving] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const turnaround = referral.turnaroundMinutes ?? referral.testTurnaroundMinutes;
  return (
    <TableRow>
      <TableCell>
        {referral.testName}
        <span className="block font-mono text-meta text-muted-foreground">{referral.testCode}</span>
      </TableCell>
      <TableCell className="text-table">
        {referral.referenceLaboratoryName}
        {referral.referenceLaboratoryStatus === "inactive" ? (
          <Badge variant="warning" className="ml-1">
            <CirclePauseIcon aria-hidden /> Inactive: not sent out
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="text-table">
        {turnaround ? formatDuration(turnaround) : "—"}
        {referral.turnaroundMinutes === null && turnaround ? <span className="block text-meta text-muted-foreground">the test&apos;s own</span> : null}
      </TableCell>
      {canManage ? (
        <TableCell className="text-right">
          {removing ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => removeTestReferral({ testId: referral.testId, reason }),
                  `${referral.testName}: performed in-house`,
                  () => setRemoving(false),
                );
              }}
            >
              <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              <Button type="submit" size="xs" variant="destructive" disabled={pending || reason.trim().length < 3}>
                Stop
              </Button>
            </form>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => setRemoving(true)}>
              Stop referring…
            </Button>
          )}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function NewReferral({ tests, referenceLabs, referrals }: { tests: LabTest[]; referenceLabs: ReferenceLaboratory[]; referrals: LabTestReferral[] }) {
  const { pending, run } = useRun();
  const referred = new Set(referrals.map((r) => r.testId));
  const [testId, setTestId] = React.useState("");
  const [labId, setLabId] = React.useState(referenceLabs[0]?.id ?? "");
  const [hours, setHours] = React.useState("");
  const parsedHours = hours.trim() === "" ? null : Number(hours);
  const validHours = parsedHours === null || (Number.isInteger(parsedHours) && parsedHours > 0);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => setTestReferral({ testId, referenceLaboratoryId: labId, turnaroundHours: parsedHours }),
          "Referral saved",
          () => {
            setTestId("");
            setHours("");
          },
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="referral-test">Test</Label>
        <NativeSelect placeholder="Choose…" id="referral-test" value={testId} onChange={(e) => setTestId(e.target.value)}>
          {tests.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {referred.has(t.id) ? " (change)" : ""}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="referral-lab">Reference laboratory</Label>
        <NativeSelect id="referral-lab" value={labId} onChange={(e) => setLabId(e.target.value)}>
          {referenceLabs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="referral-hours">Turnaround (hours)</Label>
        <Input id="referral-hours" inputMode="numeric" className="w-28" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Test's own" />
      </div>
      <Button type="submit" size="sm" disabled={pending || !testId || !labId || !validHours}>
        Refer out
      </Button>
    </form>
  );
}
