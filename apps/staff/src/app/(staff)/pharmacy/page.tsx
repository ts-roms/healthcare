import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { RecentDispenses } from "@/lib/api/types";

export const metadata = { title: "Pharmacy" };

/** Dispensing: find a prescription by its number, and today's dispenses at the selected facility. */
export default async function PharmacyPage({ searchParams }: { searchParams: Promise<{ number?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "prescription.dispense")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Pharmacy" />
        <FacilityRequired action="Dispensing takes stock from this facility's locations." />
      </>
    );
  }
  const number = params.number?.trim();
  let notFound = false;
  let foundId: string | null = null;
  if (number) {
    try {
      foundId = (await api<{ prescriptionId: string }>("/dispensing/prescriptions", { query: { number } })).prescriptionId;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound = true;
      else throw error;
    }
  }
  if (foundId) redirect(`/pharmacy/${foundId}`);
  const today = await api<RecentDispenses>("/dispensing/dispenses");
  return (
    <>
      <PageHeader title="Pharmacy" description={`${facility.name} · dispense prescribed medicines from stock`} />
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <CardContent>
            <form className="flex flex-wrap items-end gap-2" action="/pharmacy">
              <div className="flex flex-col gap-1">
                <Label htmlFor="rx-number">Prescription number</Label>
                <Input id="rx-number" name="number" placeholder="RX00000001" defaultValue={number ?? ""} className="w-56 font-mono" autoFocus />
              </div>
              <Button type="submit">
                <SearchIcon /> Find
              </Button>
              {notFound ? (
                <p role="alert" className="text-body text-danger-foreground">
                  No prescription {number} in this organization.
                </p>
              ) : null}
            </form>
            <p className="mt-2 text-meta text-muted-foreground">
              The number is printed on the prescription (and shown to the patient in MyHealth). Check the patient&apos;s identity before handing over.
            </p>
          </CardContent>
        </Card>
        <Card className="py-0">
          {today.dispenses.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">Nothing dispensed here today.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {today.dispenses.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap">{clinicalTime(d.dispensedAt)}</TableCell>
                    <TableCell>
                      <Link href={`/pharmacy/${d.prescriptionId}`} className="underline-offset-2 hover:underline">
                        {d.patient?.displayName ?? "—"}
                      </Link>
                      <div className="text-meta text-muted-foreground">{d.patient?.patientNumber}</div>
                    </TableCell>
                    <TableCell>{d.itemName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.quantity} <span className="text-meta text-muted-foreground">{d.stockUnit}</span>
                    </TableCell>
                    <TableCell>{d.status === "reversed" ? <Badge variant="neutral">Reversed</Badge> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
