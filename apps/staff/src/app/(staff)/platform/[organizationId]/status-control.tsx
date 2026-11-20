"use client";

import * as React from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea } from "@healthcare/ui/primitives";
import { useServerAction } from "@/lib/use-server-action";
import { changeTenantStatus } from "../actions";

/**
 * Suspend or reactivate an organization, with a reason kept in its history. Suspending ends every staff and MyHealth
 * session at once; the organization you are signed in to cannot be suspended from inside it.
 */
export function TenantStatusControl({
  organizationId,
  name,
  status,
  version,
  isCurrentOrganization,
}: {
  organizationId: string;
  name: string;
  status: string;
  version: number;
  isCurrentOrganization: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { pending, run } = useServerAction();
  if (status === "archived") return null;
  const suspending = status === "active";
  if (suspending && isCurrentOrganization) {
    return <p className="text-meta text-muted-foreground">You are signed in to this organization. Sign in to another one to suspend it.</p>;
  }
  return (
    <>
      <Button size="sm" variant={suspending ? "destructive" : "default"} onClick={() => setOpen(true)}>
        {suspending ? "Suspend…" : "Reactivate…"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {suspending ? "Suspend" : "Reactivate"} {name}
            </DialogTitle>
            <DialogDescription>
              {suspending
                ? "Every staff and MyHealth session of this organization ends now, and nobody of it can sign in until it is reactivated. Its scheduled outreach waits. Records stay as they are."
                : "Its staff and patients can sign in again. Sessions that ended with the suspension stay ended."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="status-reason">Reason (kept in the organization&apos;s history and audit trail)</Label>
            <Textarea id="status-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={suspending ? "destructive" : "default"}
              disabled={pending || reason.trim().length < 10}
              onClick={() =>
                run(
                  () => changeTenantStatus({ organizationId, status: suspending ? "suspended" : "active", reason, version }),
                  suspending ? `${name} suspended` : `${name} reactivated`,
                  () => {
                    setOpen(false);
                    setReason("");
                  },
                )
              }
            >
              {suspending ? "Suspend organization" : "Reactivate organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
