import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2Icon, InfoIcon, PackageCheckIcon, RefreshCwIcon, XCircleIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Checkbox, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { Page, Practitioner, PrescriptionLogEntry } from "@/lib/api/types";
import { todayInManila } from "@/lib/consent-form";
import { MAX_DAYS, PRESCRIPTION_STATUS_LABEL, prescriptionApiQuery, prescriptionLogHref, readPrescriptionFilters } from "@/lib/prescription-log";

export const metadata = { title: "Prescriptions" };

function StatusBadge({ status }: { status: PrescriptionLogEntry["status"] }) {
  if (status === "active")
    return (
      <Badge variant="success">
        <CheckCircle2Icon aria-hidden /> {PRESCRIPTION_STATUS_LABEL.active}
      </Badge>
    );
  if (status === "superseded")
    return (
      <Badge variant="neutral">
        <RefreshCwIcon aria-hidden /> {PRESCRIPTION_STATUS_LABEL.superseded}
      </Badge>
    );
  return (
    <Badge variant="warning">
      <XCircleIcon aria-hidden /> {PRESCRIPTION_STATUS_LABEL.cancelled}
    </Badge>
  );
}

/**
 * Prescriptions issued at the selected facility over a period: number, patient, medicines by name, prescriber,
 * status and whether anything was dispensed here. Doses and instructions stay on the prescription itself (the
 * consultation, or the pharmacy). Viewing is audited.
 */
export default async function PrescriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "prescription.read") || !can(session, "patient.read")) redirect("/");
  const { filters, adjusted } = readPrescriptionFilters(params, todayInManila());
  const [page, practitioners] = await Promise.all([
    api<Page<PrescriptionLogEntry>>("/prescriptions/log", { query: prescriptionApiQuery(filters) }),
    can(session, "appointment.read") ? api<Practitioner[]>("/clinic/practitioners").catch(() => [] as Practitioner[]) : Promise.resolve([] as Practitioner[]),
  ]);
  const prescribers = practitioners.filter((p) => p.profession === "physician" || p.profession === "dentist");
  const canDispense = can(session, "prescription.dispense");

  return (
    <>
      <PageHeader
        title="Prescriptions"
        description="Prescriptions issued at this facility. Open one in its consultation for doses and instructions, or at the pharmacy to dispense it."
      />
      <div className="flex flex-col gap-4 p-4">
        <form method="get" className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
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
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="cancelled">Cancelled</option>
              <option value="superseded">Replaced</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="rx-prescriber">Prescriber</Label>
            <NativeSelect id="rx-prescriber" name="prescriber" defaultValue={filters.prescriber} emptyText="No prescribers set up">
              <option value="">Anyone</option>
              {prescribers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="rx-number">Number</Label>
            <Input id="rx-number" name="number" placeholder="RX00000123" maxLength={10} defaultValue={filters.number} />
          </div>
          <div className="flex items-center gap-2 self-end pb-2">
            <Checkbox id="rx-mine" name="mine" value="1" defaultChecked={filters.mine} />
            <Label htmlFor="rx-mine">Only mine</Label>
          </div>
          <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
            <Button type="submit" size="sm">
              Show
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/clinic/prescriptions">Today</Link>
            </Button>
          </div>
          {adjusted ? (
            <p className="flex items-center gap-1.5 text-meta text-muted-foreground sm:col-span-3 lg:col-span-6">
              <InfoIcon className="size-3.5" aria-hidden /> A period is at most {MAX_DAYS} days; showing the last {MAX_DAYS} days to {filters.to}.
            </p>
          ) : null}
        </form>

        {page.items.length === 0 ? (
          <p className="text-table text-muted-foreground">No prescriptions match.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issued</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Medicines</TableHead>
                <TableHead>Prescriber</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((rx) => (
                <TableRow key={rx.id}>
                  <TableCell className="whitespace-nowrap">{clinicalDateTime(rx.issuedAt)}</TableCell>
                  <TableCell>
                    <Link className="font-mono text-primary hover:underline" href={`/clinic/encounters/${rx.encounterId}`}>
                      {rx.prescriptionNumber}
                    </Link>
                    {canDispense && rx.status === "active" ? (
                      <Link className="block text-meta text-primary hover:underline" href={`/pharmacy/${rx.id}`}>
                        Dispense
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {rx.patient ? (
                      <Link className="text-primary hover:underline" href={`/patients/${rx.patient.id}`}>
                        {rx.patient.displayName}
                        <span className="block font-mono text-meta text-muted-foreground">
                          {rx.patient.patientNumber} · {rx.patient.age} y · {rx.patient.sex}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Unknown patient</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal">{rx.medicines.join("; ")}</TableCell>
                  <TableCell>{rx.prescriber.name ?? "—"}</TableCell>
                  <TableCell>
                    <span className="flex flex-col items-start gap-1">
                      <StatusBadge status={rx.status} />
                      {rx.dispensed ? (
                        <Badge variant="info">
                          <PackageCheckIcon aria-hidden /> Dispensed here
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <nav aria-label="Pages" className="flex items-center gap-2 text-table">
          {filters.page > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={prescriptionLogHref(filters, filters.page - 1)}>Newer</Link>
            </Button>
          ) : null}
          <span className="text-muted-foreground">Page {filters.page}</span>
          {page.hasMore ? (
            <Button asChild size="sm" variant="outline">
              <Link href={prescriptionLogHref(filters, filters.page + 1)}>Older</Link>
            </Button>
          ) : null}
        </nav>
      </div>
    </>
  );
}
