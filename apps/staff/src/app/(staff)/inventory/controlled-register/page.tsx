import { redirect } from "next/navigation";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import {
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
import type { ControlledRegister } from "@/lib/api/types";
import { shiftDate, todayIn } from "@/lib/clinic-mapping";
import { InventoryNav } from "../inventory-nav";
import { RegisterSettingForm } from "./register-setting";

export const metadata = { title: "Controlled register" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (date: string) => clinicalDate(`${date}T12:00:00Z`);

const KIND_LABEL: Record<string, string> = {
  receipt: "Received",
  issue: "Issued",
  transfer_out: "Transferred out",
  transfer_in: "Transferred in",
  adjustment: "Count adjustment",
  write_off: "Written off",
  return: "Returned",
};

/**
 * The register of controlled items at the selected facility, read from the stock ledger: the balance before the period,
 * every movement with its reference, recipient and reason, and the running balance. The platform's own layout — whether
 * it serves as the register the regulator requires is for the organization to confirm.
 */
export default async function ControlledRegisterPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.controlled-register.read")) redirect("/inventory");
  const nav = <InventoryNav canConfigure={can(session, "inventory.catalog.manage")} canValue={can(session, "inventory.valuation.read")} canRegister />;
  if (!facility) {
    return (
      <>
        <PageHeader title="Controlled register" actions={nav} />
        <FacilityRequired action="The register is kept per facility." />
      </>
    );
  }
  const today = todayIn(facility.timezone);
  const to = params.to && DATE.test(params.to) ? params.to : today;
  const from = params.from && DATE.test(params.from) && params.from <= to ? params.from : shiftDate(to, -29);
  const register = await api<ControlledRegister>("/inventory/controlled-register", { query: { from, to } });
  return (
    <>
      <PageHeader title="Controlled register" description={`${facility.name} · every movement of controlled items, from the stock ledger`} actions={nav} />
      <div className="flex flex-col gap-4 p-4">
        <p className="rounded-md border border-dashed p-3 text-meta text-muted-foreground">
          This is the platform&apos;s own layout of the stock ledger. Dangerous Drugs Board and FDA register requirements are not built in: confirm with your
          pharmacist or adviser that it serves as your register, and record the review under Admin → Compliance.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Register details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p>
              Licence reference: {register.setting.licenceReference ?? "not recorded"} · Responsible person:{" "}
              {register.setting.responsiblePerson ?? "not recorded"}
            </p>
            {can(session, "inventory.catalog.manage") ? <RegisterSettingForm setting={register.setting} /> : null}
          </CardContent>
        </Card>
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Period">
          <div className="grid gap-1">
            <Label htmlFor="reg-from">From</Label>
            <DateInput id="reg-from" name="from" defaultValue={from} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="reg-to">To</Label>
            <DateInput id="reg-to" name="to" defaultValue={to} className="w-40" />
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
          <a className="text-table text-primary hover:underline" href={`/inventory/controlled-register/export?from=${from}&to=${to}`} download>
            Download CSV
          </a>
        </form>
        {register.sections.length === 0 ? (
          <p className="text-body text-muted-foreground">No controlled items were held or moved at this facility in the period.</p>
        ) : (
          register.sections.map((s) => (
            <Card key={`${s.item.id}:${s.location.id}`}>
              <CardHeader>
                <CardTitle>
                  {s.item.name} · {s.location.name}
                </CardTitle>
                <p className="ml-auto text-meta text-muted-foreground">
                  {day(from)} to {day(to)} · in {s.received} · out {s.removed} {s.item.stockUnit}
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Movement</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Lot</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>To / reason</TableHead>
                      <TableHead>Recorded by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground">
                        Balance before the period
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{s.opening}</TableCell>
                      <TableCell colSpan={4} />
                    </TableRow>
                    {s.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap">{clinicalDateTime(l.recordedAt)}</TableCell>
                        <TableCell>{KIND_LABEL[l.kind] ?? l.kind}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.quantity > 0 ? `+${l.quantity}` : l.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.balance}</TableCell>
                        <TableCell>
                          {l.lotNumber ?? "—"}
                          {l.expiryDate ? <span className="text-meta text-muted-foreground"> · exp. {day(l.expiryDate)}</span> : null}
                        </TableCell>
                        <TableCell>{l.reference ?? "—"}</TableCell>
                        <TableCell>{[l.issuedTo, l.reason].filter(Boolean).join(" · ") || "—"}</TableCell>
                        <TableCell>{l.recordedByName ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Balance at the end of the period
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{s.closing}</TableCell>
                      <TableCell colSpan={4} />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
