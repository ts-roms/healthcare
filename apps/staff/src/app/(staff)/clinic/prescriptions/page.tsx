import Link from "next/link";
import { redirect } from "next/navigation";
import { BanIcon, CheckCircle2Icon, InfoIcon, RefreshCwIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { IssuedPrescriptions } from "@/lib/api/types";
import { todayInManila } from "@/lib/consent-form";
import {
  MAX_PRESCRIPTION_LIST_DAYS,
  PRESCRIPTION_STATUS_FILTERS,
  prescribedLine,
  prescriptionListHref,
  prescriptionListQuery,
  readPrescriptionListFilters,
} from "@/lib/prescription-list";

export const metadata = { title: "Prescriptions" };

const STATUS = {
  active: { label: "Active", variant: "success", Icon: CheckCircle2Icon },
  superseded: { label: "Replaced", variant: "neutral", Icon: RefreshCwIcon },
  cancelled: { label: "Cancelled", variant: "warning", Icon: BanIcon },
} as const;

/**
 * Prescriptions issued at the selected facility: newest first over a period, by status or only the signed-in
 * practitioner's. Each opens in the consultation it was issued in; the list shows what was prescribed, not how to take it.
 */
export default async function PrescriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "prescription.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Prescriptions" />
        <FacilityRequired action="The list shows the prescriptions issued at this facility." />
      </>
    );
  }
  const { filters, adjusted } = readPrescriptionListFilters(params, todayInManila());
  let list: IssuedPrescriptions | null = null;
  let notPractitioner = false;
  try {
    list = await api<IssuedPrescriptions>("/prescriptions/issued", { query: prescriptionListQuery(filters) });
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_a_practitioner") notPractitioner = true;
    else throw error;
  }
  const canOpenConsultation = can(session, "encounter.read");

  return (
    <>
      <PageHeader title="Prescriptions" description={`${facility.name} · prescriptions issued in consultations, newest first`} />
      <div className="flex flex-col gap-4 p-4">
        <nav aria-label="Whose prescriptions" className="flex flex-wrap gap-1">
          {[
            { mine: false, label: "Everyone at this facility" },
            { mine: true, label: "Issued by me" },
          ].map((v) => (
            <Button key={v.label} asChild size="sm" variant={filters.mine === v.mine ? "default" : "outline"}>
              <Link href={prescriptionListHref({ ...filters, mine: v.mine })} aria-current={filters.mine === v.mine ? "page" : undefined}>
                {v.label}
              </Link>
            </Button>
          ))}
        </nav>

        <form method="get" className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-4">
          <div className="grid gap-1">
            <Label htmlFor="rx-from">From (day)</Label>
            <Input id="rx-from" name="from" type="date" defaultValue={filters.from} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="rx-to">To (day)</Label>
            <Input id="rx-to" name="to" type="date" defaultValue={filters.to} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="rx-status">Status</Label>
            <NativeSelect id="rx-status" name="status" defaultValue={filters.status}>
              {PRESCRIPTION_STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          {filters.mine ? <input type="hidden" name="mine" value="true" /> : null}
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm">
              Show
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/clinic/prescriptions">Today</Link>
            </Button>
          </div>
          {adjusted ? (
            <p className="flex items-center gap-1.5 text-meta text-muted-foreground sm:col-span-4">
              <InfoIcon className="size-4" aria-hidden /> The list covers at most {MAX_PRESCRIPTION_LIST_DAYS} days, so the start was moved to {filters.from}.
            </p>
          ) : null}
        </form>

        {notPractitioner ? (
          <p role="status" className="rounded-md border bg-muted px-3 py-2 text-body">
            Your account is not linked to a practitioner, so you have no prescriptions of your own.{" "}
            <Link className="text-primary hover:underline" href={prescriptionListHref({ ...filters, mine: false })}>
              Show everyone&apos;s
            </Link>
          </p>
        ) : list ? (
          <>
            <p className="text-meta text-muted-foreground">
              {list.from === list.to ? `On ${list.from}` : `From ${list.from} to ${list.to}`}: {list.counts.active} active, {list.counts.superseded} replaced,{" "}
              {list.counts.cancelled} cancelled.
              {list.truncated ? " Only the newest 300 are listed; choose a shorter period to see the rest." : ""}
            </p>
            <Card className="py-0">
              {list.rows.length === 0 ? (
                <p className="p-4 text-body text-muted-foreground">No prescriptions in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prescription</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Prescribed</TableHead>
                      <TableHead>Prescriber</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.rows.map((r) => {
                      const status = STATUS[r.status];
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            {canOpenConsultation ? (
                              <Link className="font-mono font-medium text-primary hover:underline" href={`/clinic/encounters/${r.encounterId}`}>
                                {r.prescriptionNumber}
                              </Link>
                            ) : (
                              <span className="font-mono font-medium">{r.prescriptionNumber}</span>
                            )}
                            <span className="block text-meta text-muted-foreground">{clinicalDateTime(r.issuedAt)}</span>
                          </TableCell>
                          <TableCell>
                            {r.patient ? (
                              <Link className="hover:underline" href={`/patients/${r.patientId}`}>
                                {r.patient.displayName} <span className="text-muted-foreground">· {r.patient.patientNumber}</span>
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-meta">
                            <ul className="flex flex-col gap-0.5">
                              {r.items.map((item, i) => (
                                <li key={i}>{prescribedLine(item)}</li>
                              ))}
                            </ul>
                          </TableCell>
                          <TableCell className="text-meta">{r.prescriber.displayName ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={status.variant}>
                              <status.Icon aria-hidden /> {status.label}
                            </Badge>
                            {r.status === "cancelled" && r.cancellationReason ? (
                              <span className="mt-1 block text-meta text-muted-foreground">{r.cancellationReason}</span>
                            ) : null}
                            {r.replacesPrescriptionId ? <span className="mt-1 block text-meta text-muted-foreground">Replaces an earlier one</span> : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
