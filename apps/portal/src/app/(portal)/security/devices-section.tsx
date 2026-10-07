"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MonitorSmartphoneIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import type { PortalTrustedDevice } from "@/lib/api/types";
import { resultDate } from "@/lib/records";
import { securityMessage } from "@/lib/security";
import { forgetAllDevices, forgetDevice } from "./actions";

/** Browsers remembered after the second step ("don't ask for a code on this browser"): see them, forget one or all. */
export function DevicesSection({ devices, timeZone }: { devices: PortalTrustedDevice[]; timeZone: string }) {
  const router = useRouter();
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const act = (run: () => Promise<{ ok: boolean; message?: string; code?: string }>, ok: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await run();
      if (result.ok) {
        setMessage(ok);
        router.refresh();
      } else setMessage(securityMessage(result.code, result.message ?? "Something went wrong."));
    });
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-labelledby="devices-heading">
      <h2 id="devices-heading" className="flex items-center gap-2 font-semibold">
        <MonitorSmartphoneIcon className="size-4" aria-hidden /> Remembered browsers
      </h2>
      <p className="text-body text-muted-foreground">
        A browser you asked not to be asked for a code on, for 30 days. Your password is still needed. Forget any browser you no longer use or did not mean to
        remember.
      </p>
      {devices.length === 0 ? (
        <p className="text-body text-muted-foreground">No browser is remembered.</p>
      ) : (
        <ul className="flex flex-col divide-y" aria-label="Remembered browsers">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="text-body font-medium">
                  {d.label}
                  {d.current ? <span className="ml-2 rounded-full bg-info-subtle px-2 py-0.5 text-meta text-info-foreground">This browser</span> : null}
                </p>
                <p className="text-meta text-muted-foreground">
                  Last used {resultDate(d.lastUsedAt, timeZone)} · until {resultDate(d.expiresAt, timeZone)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => act(() => forgetDevice(d.id, d.current), "Browser forgotten.")}
              >
                Forget
              </Button>
            </li>
          ))}
        </ul>
      )}
      {devices.length > 1 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          disabled={pending}
          onClick={() => act(forgetAllDevices, "Every browser forgotten.")}
        >
          Forget all
        </Button>
      ) : null}
      {message ? (
        <p role="status" className="text-body text-muted-foreground">
          {message}
        </p>
      ) : null}
    </section>
  );
}
