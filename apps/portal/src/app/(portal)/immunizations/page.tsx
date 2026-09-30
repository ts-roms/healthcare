import { SyringeIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalImmunization } from "@/lib/api/types";
import { byVaccine, sourceText, whenGiven } from "@/lib/immunizations";

export const metadata = { title: "Immunizations" };

/**
 * The patient's immunization history: doses given at the clinic, recorded from their vaccination record, or received
 * from another provider. It is a record of what was given, not advice about which vaccine is due.
 */
export default async function ImmunizationsPage() {
  const { timeZone } = await getMe();
  const items = await portalApi<PortalImmunization[]>("/portal/immunizations");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Your immunizations</h1>
        <p className="text-body text-muted-foreground">
          Vaccines recorded in your health record. Ask your doctor or nurse which vaccines you may still need. If something is missing or wrong, tell the clinic
          at your next visit.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={SyringeIcon} title="No immunizations recorded">
          Vaccines given at the clinic, or copied from your vaccination card, appear here.
        </EmptyState>
      ) : (
        byVaccine(items).map((group) => (
          <section key={group.vaccine} className="flex flex-col gap-2 rounded-xl border bg-card p-4" aria-label={group.vaccine}>
            <h2 className="flex items-center gap-2 font-semibold">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                <SyringeIcon className="size-4" aria-hidden />
              </span>
              {group.vaccine}
            </h2>
            <ul className="flex flex-col divide-y">
              {group.doses.map((d) => (
                <li key={d.id} className="flex flex-col gap-0.5 py-2">
                  <p className="font-medium">
                    {whenGiven(d, timeZone)}
                    {d.dose ? <span className="font-normal text-muted-foreground"> · {d.dose}</span> : null}
                  </p>
                  <p className="text-meta text-muted-foreground">{[d.vaccineProduct, d.where, sourceText(d.source)].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
