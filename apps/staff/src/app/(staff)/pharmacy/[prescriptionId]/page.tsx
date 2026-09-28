import { notFound, redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { DispensableStock, DispensingView } from "@/lib/api/types";
import { quantityWithUnit } from "@/lib/inventory-mapping";
import { lineSummary } from "@/lib/prescription-form";
import { DispenseForm, ReverseDispense } from "./dispense-form";

export const metadata = { title: "Dispense" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DispensePage({ params }: { params: Promise<{ prescriptionId: string }> }) {
  const [{ prescriptionId }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "prescription.dispense")) redirect("/");
  if (!UUID.test(prescriptionId)) notFound();
  if (!facility) {
    return (
      <>
        <PageHeader title="Dispense" />
        <FacilityRequired action="Dispensing takes stock from this facility's locations." />
      </>
    );
  }
  let view: DispensingView;
  try {
    view = await api<DispensingView>(`/dispensing/prescriptions/${prescriptionId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const canMove = can(session, "inventory.move") && can(session, "inventory.read");
  const stock = canMove ? await api<DispensableStock[]>("/dispensing/stock") : [];
  const rx = view.prescription;
  const active = rx.status === "active";
  return (
    <>
      <PageHeader
        title={`Prescription ${rx.prescriptionNumber}`}
        description={`Issued ${clinicalDateTime(rx.issuedAt)}${view.patient ? ` · ${view.patient.displayName} (${view.patient.patientNumber}), ${view.patient.age} y, ${view.patient.sex}` : ""}`}
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-3">
          {!active ? (
            <p role="alert" className="rounded-md border border-danger/25 bg-danger-subtle p-3 text-body text-danger-foreground">
              This prescription is {rx.status}
              {rx.cancellationReason ? ` (${rx.cancellationReason})` : ""}. It cannot be dispensed.
            </p>
          ) : null}
          {rx.allergyWarnings.length > 0 ? (
            <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3 text-body text-warning-foreground">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Prescribed despite a recorded allergy (decision support overridden by the prescriber)</p>
                <ul>
                  {rx.allergyWarnings.map((w) => (
                    <li key={`${w.allergyId}-${w.medication}`}>
                      {w.medication}: allergy to {w.substance} ({w.criticality}
                      {w.reaction ? `, ${w.reaction}` : ""})
                    </li>
                  ))}
                </ul>
                {rx.allergyOverrideReason ? <p>Reason given: {rx.allergyOverrideReason}</p> : null}
              </div>
            </div>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Prescribed</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2 text-body">
                {rx.items.map((item) => {
                  const status = view.items.find((i) => i.prescriptionItemId === item.id);
                  return (
                    <li key={item.id}>
                      <p className="font-medium">
                        {item.lineNumber}. {lineSummary(item)}
                      </p>
                      <p className="text-muted-foreground">{item.instructions}</p>
                      <p className="text-meta">
                        Dispensed:{" "}
                        {status && status.dispensed.length > 0
                          ? status.dispensed.map((d) => quantityWithUnit(d.quantity, d.stockUnit)).join(", ")
                          : "nothing yet"}
                        {status?.remaining !== null && status?.remaining !== undefined
                          ? ` · ${quantityWithUnit(status.remaining, item.quantityUnit)} left${item.refills ? " (refills included)" : ""}`
                          : " · dispensed in another unit: check the amount against the prescription"}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Dispenses</CardTitle>
            </CardHeader>
            <CardContent>
              {view.dispenses.length === 0 ? (
                <p className="text-body text-muted-foreground">Nothing dispensed yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-body">
                  {view.dispenses.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <span>{clinicalDateTime(d.dispensedAt)}</span>
                      <span className="font-medium">
                        {d.itemName} × {quantityWithUnit(d.quantity, d.stockUnit)}
                      </span>
                      {d.status === "reversed" ? (
                        <Badge variant="neutral">Reversed · {d.reversalReason}</Badge>
                      ) : canMove && d.facilityId === facility.id ? (
                        <ReverseDispense dispenseId={d.id} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        {active && canMove ? <DispenseForm prescriptionId={rx.id} items={rx.items} stock={stock} /> : null}
      </div>
    </>
  );
}
