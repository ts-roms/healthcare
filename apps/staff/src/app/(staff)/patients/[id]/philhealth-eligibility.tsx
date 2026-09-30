"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlugZapIcon, SendIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, DateInput, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { EligibilityBadge } from "@/components/eligibility-badge";
import type { EligibilityCheck, EligibilityOverview } from "@/lib/api/types";
import { recordEligibility, requestEligibility } from "./eligibility-actions";

/**
 * PhilHealth eligibility on the patient record: the history of checks (answers
 * never change) and a way to record what PhilHealth's own channel answered.
 * The platform records PhilHealth's answer; it does not decide eligibility.
 */
export function PhilHealthEligibility({
  patientId,
  overview,
  today,
  facilitySelected,
}: {
  patientId: string;
  overview: EligibilityOverview;
  today: string;
  facilitySelected: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [f, setF] = React.useState({ serviceDate: today, answer: "eligible" as EligibilityCheck["status"], reference: "", note: "" });
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const connected = overview.integration.status !== "dependency";

  const act = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="flex flex-col gap-3 text-body">
      {overview.checks.length ? (
        <ul className="flex flex-col gap-1.5" aria-label="Eligibility checks">
          {overview.checks.slice(0, 5).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <EligibilityBadge status={c.status} />
              <span>for {clinicalDate(c.serviceDate)}</span>
              {c.externalReference ? <span className="text-muted-foreground">Ref. {c.externalReference}</span> : null}
              <span className="text-meta text-muted-foreground">{c.source === "external_channel" ? "PhilHealth's channel" : "adapter"}</span>
              {c.note ? <span className="text-meta text-muted-foreground">· {c.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No eligibility checks recorded.</p>
      )}
      {!facilitySelected ? (
        <p className="text-meta text-muted-foreground">Select a facility to record a check.</p>
      ) : (
        <>
          {connected ? null : (
            <p className="flex gap-2 rounded-md border border-warning bg-warning-subtle p-2 text-meta text-warning-foreground">
              <PlugZapIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Not connected to PhilHealth. Check through PhilHealth&apos;s own channel, then record its answer and reference here.</span>
            </p>
          )}
          <form
            className="grid gap-2 sm:grid-cols-2"
            aria-label="Record PhilHealth's answer"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () =>
                  recordEligibility({
                    patientId,
                    serviceDate: f.serviceDate,
                    answer: f.answer as "eligible" | "not_eligible" | "undetermined",
                    reference: f.reference,
                    note: f.note || undefined,
                  }),
                "Eligibility recorded",
                () => setF({ ...f, reference: "", note: "" }),
              );
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="elig-date">Date of service</Label>
              <DateInput id="elig-date" value={f.serviceDate} onChange={(e) => setF({ ...f, serviceDate: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="elig-answer">PhilHealth&apos;s answer</Label>
              <NativeSelect id="elig-answer" value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value as EligibilityCheck["status"] })}>
                <option value="eligible">Eligible</option>
                <option value="not_eligible">Not eligible</option>
                <option value="undetermined">Undetermined</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="elig-reference">Reference</Label>
              <Input id="elig-reference" value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="elig-note">Note (optional)</Label>
              <Input id="elig-note" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending || !f.reference.trim()}>
                Record answer
              </Button>
              {connected ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => requestEligibility({ patientId, serviceDate: f.serviceDate, idempotencyKey: key }),
                      "Asking PhilHealth",
                      () => setKey(crypto.randomUUID()),
                    )
                  }
                >
                  <SendIcon /> Ask PhilHealth
                </Button>
              ) : null}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
