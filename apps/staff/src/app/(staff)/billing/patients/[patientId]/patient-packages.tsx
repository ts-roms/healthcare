"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PackageIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { BillingPackage, PackageEnrollment } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { cancelPackage, sellPackage } from "../../actions";

/**
 * The patient's packages at this facility: what is left of each included
 * service, selling a package (charged at its price), and cancelling one that
 * was not used. Coverage of later charges is decided by the API.
 */
export function PatientPackages({
  patientId,
  enrollments,
  packages,
  canSell,
}: {
  patientId: string;
  enrollments: PackageEnrollment[];
  packages: BillingPackage[];
  canSell: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [packageId, setPackageId] = React.useState("");
  const onSale = packages.filter((p) => p.status === "active" && p.currentPrice !== null);
  const sell = () =>
    startTransition(async () => {
      const result = await sellPackage({ patientId, packageServiceId: packageId });
      if (result.ok) {
        toast.success(`${result.data.packageName} sold; it is on the charges to invoice`);
        setPackageId("");
        router.refresh();
      } else toast.error(result.message);
    });
  if (enrollments.length === 0 && (!canSell || onSale.length === 0)) return null;
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <PackageIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Packages</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {enrollments.length === 0 ? <p className="px-4 text-body text-muted-foreground">No packages at this facility.</p> : null}
        <ul className="divide-y">
          {enrollments.map((e) => (
            <Enrollment key={e.id} enrollment={e} canCancel={canSell} />
          ))}
        </ul>
        {canSell && onSale.length ? (
          <div className="flex flex-wrap items-center gap-2 px-4">
            <NativeSelect
              placeholder="Sell a package…"
              aria-label="Package to sell"
              className="min-w-48 flex-1"
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
            >
              {onSale.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {peso(p.currentPrice ?? 0)}
                </option>
              ))}
            </NativeSelect>
            <Button type="button" size="sm" disabled={pending || !packageId} onClick={sell}>
              Sell
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Enrollment({ enrollment: e, canCancel }: { enrollment: PackageEnrollment; canCancel: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const unused = e.items.every((i) => i.used === 0);
  const cancel = () =>
    startTransition(async () => {
      const result = await cancelPackage({ enrollmentId: e.id, reason, version: e.version });
      if (result.ok) {
        toast.success(`${e.packageName} cancelled`);
        router.refresh();
      } else toast.error(result.message);
    });
  return (
    <li className={`flex flex-col gap-1 px-4 py-2 text-body ${e.status === "cancelled" ? "opacity-60" : ""}`}>
      <span className="flex items-center gap-2">
        <span className="font-medium">{e.packageName}</span>
        <Badge variant={e.status === "active" ? "success" : "neutral"}>{e.status === "active" ? "Active" : "Cancelled"}</Badge>
        <span className="ml-auto text-meta text-muted-foreground">
          {clinicalDate(e.startsOn)}
          {e.endsOn ? ` – ${clinicalDate(e.endsOn)}` : ""}
        </span>
      </span>
      <ul className="text-table">
        {e.items.map((i) => (
          <li key={i.serviceId} className="flex justify-between gap-2">
            <span>{i.serviceName}</span>
            <span className="tabular-nums">
              {i.left} of {i.included} left
            </span>
          </li>
        ))}
      </ul>
      {e.cancelReason ? <span className="text-meta text-muted-foreground">Cancelled: {e.cancelReason}</span> : null}
      {canCancel && e.status === "active" && unused ? (
        cancelling ? (
          <span className="flex items-center gap-1.5">
            <Input
              aria-label="Reason for cancelling"
              className="h-7 flex-1"
              value={reason}
              maxLength={500}
              onChange={(ev) => setReason(ev.target.value)}
              placeholder="Reason"
            />
            <Button type="button" size="xs" variant="destructive" disabled={pending || reason.trim().length < 3} onClick={cancel}>
              Cancel package
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setCancelling(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button type="button" size="xs" variant="ghost" className="self-start" onClick={() => setCancelling(true)}>
            Cancel unused package…
          </Button>
        )
      ) : null}
      {e.status === "active" && e.saleCharge?.invoiceId && unused ? (
        <span className="text-meta text-muted-foreground">Already invoiced: cancelling does not refund it; credit the invoice.</span>
      ) : null}
    </li>
  );
}
