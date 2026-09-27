import { PillIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import type { PortalPrescription } from "@/lib/api/types";
import { howToTake, resultDate } from "@/lib/records";

export const metadata = { title: "Prescriptions" };

export default async function PrescriptionsPage() {
  const prescriptions = await portalApi<PortalPrescription[]>("/portal/prescriptions");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Your medicines</h1>
        <p className="text-body text-muted-foreground">
          Active prescriptions from your doctors. Follow your doctor&apos;s instructions; ask your pharmacist or doctor if unsure.
        </p>
      </div>
      {prescriptions.length === 0 ? (
        <EmptyState icon={PillIcon} title="No active prescriptions">
          Prescriptions your doctor issues appear here.
        </EmptyState>
      ) : (
        prescriptions.map((rx) => (
          <section key={rx.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <p className="text-meta text-muted-foreground">
              {rx.prescriberName ?? "Your doctor"} · {resultDate(rx.issuedAt)} · <span className="font-mono">{rx.prescriptionNumber}</span>
            </p>
            <ul className="flex flex-col gap-3">
              {rx.items.map((item, index) => (
                <li key={index} className="flex gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-subtle text-success-foreground">
                    <PillIcon className="size-5" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold">
                      {item.genericName}
                      {item.strength ? ` ${item.strength}` : ""}
                      {item.brandName ? <span className="font-normal text-muted-foreground"> ({item.brandName})</span> : null}
                    </p>
                    <p className="text-body">{howToTake(item)}</p>
                    <p className="text-body text-muted-foreground">{item.instructions}</p>
                    <p className="text-meta text-muted-foreground">
                      {item.quantity} {item.quantityUnit}
                      {item.refills ? ` · ${item.refills} refill${item.refills === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {rx.notes ? <p className="text-meta text-muted-foreground">Note: {rx.notes}</p> : null}
          </section>
        ))
      )}
    </div>
  );
}
