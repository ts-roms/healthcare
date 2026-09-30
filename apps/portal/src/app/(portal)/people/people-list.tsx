"use client";

import * as React from "react";
import { UserRoundIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import type { PortalDependent, PortalGuardian } from "@/lib/api/types";
import { RELATIONSHIP_LABEL } from "@/lib/proxy-access";
import { actFor, endAccess } from "./actions";

const access = (scopes: string[]) => (scopes.includes("act") ? "Can see and make changes" : "Can only look");

/** The people this account holder may act for, and those who may act for them. */
export function PeopleList({ dependents, guardians, timeZone }: { dependents: PortalDependent[]; guardians: PortalGuardian[]; timeZone: string }) {
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const date = (iso: string) => new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone }).format(new Date(iso));
  const open = (patientId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await actFor(patientId);
      if (result && !result.ok) setError(result.message);
    });
  const end = (grantId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await endAccess(grantId);
      if (result.ok) setConfirming(null);
      else setError(result.message);
    });
  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-body">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="dependents" className="flex flex-col gap-3">
        <h2 id="dependents" className="text-section font-semibold">
          People you can act for
        </h2>
        {dependents.length === 0 ? (
          <p className="text-body text-muted-foreground">
            No one yet. To act for a child or a family member, ask the clinic front desk; they will check who you are and record your right to act.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {dependents.map((d) => (
              <li key={d.grantId} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <UserRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{d.displayName}</span>
                    <span className="text-meta text-muted-foreground">
                      {RELATIONSHIP_LABEL[d.relationship] ?? d.relationship} · {access(d.scopes)} · since {date(d.grantedAt)}
                      {d.expiresAt ? ` · until ${date(d.expiresAt)}` : ""}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={pending} onClick={() => open(d.patientId)}>
                    Open {d.displayName.split(" ")[0]}&apos;s MyHealth
                  </Button>
                  {confirming === d.grantId ? (
                    <>
                      <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => end(d.grantId)}>
                        Yes, give up access
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(d.grantId)}>
                      Give up access
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="guardians" className="flex flex-col gap-3">
        <h2 id="guardians" className="text-section font-semibold">
          People who can act for you
        </h2>
        {guardians.length === 0 ? (
          <p className="text-body text-muted-foreground">No one else can see or act on your records in MyHealth.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {guardians.map((g) => (
              <li key={g.grantId} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex flex-col">
                  <span className="font-semibold">{g.displayName}</span>
                  <span className="text-meta text-muted-foreground">
                    {RELATIONSHIP_LABEL[g.relationship] ?? g.relationship} · {access(g.scopes)} · since {date(g.grantedAt)}
                    {g.expiresAt ? ` · until ${date(g.expiresAt)}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {confirming === g.grantId ? (
                    <>
                      <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => end(g.grantId)}>
                        Yes, end their access
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(g.grantId)}>
                      End their access
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
