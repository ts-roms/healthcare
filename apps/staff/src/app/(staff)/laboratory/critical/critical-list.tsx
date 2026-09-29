"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertOctagonIcon, CheckIcon, PhoneIcon } from "lucide-react";
import { clinicalDateTime, LabFlagBadge } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, Checkbox, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { LabCriticalAlert } from "@/lib/api/types";
import { referenceText, resultValue, uiFlag } from "@/lib/lab-mapping";
import { acknowledgeCritical, communicateCritical } from "../actions";

const METHOD_LABEL = { phone: "Phone", in_person: "In person", secure_message: "Secure message", other: "Other" } as const;

/** Critical results: the laboratory documents the call (with read-back); the ordering side acknowledges. */
export function CriticalList({ alerts, canCommunicate, acknowledged }: { alerts: LabCriticalAlert[]; canCommunicate: boolean; acknowledged: boolean }) {
  if (alerts.length === 0) {
    return <p className="p-4 text-body text-muted-foreground">{acknowledged ? "No acknowledged critical results." : "No critical results waiting."}</p>;
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} canCommunicate={canCommunicate} />
      ))}
    </div>
  );
}

function AlertCard({ alert, canCommunicate }: { alert: LabCriticalAlert; canCommunicate: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [form, setForm] = React.useState({
    communicatedTo: alert.orderingPractitionerName ?? "",
    method: "phone" as keyof typeof METHOD_LABEL,
    readBack: false,
    note: "",
  });
  const flag = uiFlag(alert.result.flag);
  const run = (call: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    start(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong.");
    });

  return (
    <Card className="border-critical/50">
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <AlertOctagonIcon className="size-5 text-critical" aria-hidden />
          <span className="font-semibold">{alert.patient?.displayName ?? "Patient"}</span>
          <span className="text-meta text-muted-foreground">{alert.patient ? `${alert.patient.patientNumber} · ${alert.patient.age} y` : null}</span>
          <Badge variant={alert.status === "open" ? "critical" : alert.status === "communicated" ? "warning" : "success"} className="ml-auto">
            {alert.status === "open" ? "Not yet communicated" : alert.status === "communicated" ? "Communicated — awaiting acknowledgement" : "Acknowledged"}
          </Badge>
        </div>
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{alert.testName}</span>
          <span className="font-mono text-section font-semibold">{resultValue(alert.result)}</span>
          {alert.result.unit ? <span className="text-meta text-muted-foreground">{alert.result.unit}</span> : null}
          {flag ? <LabFlagBadge flag={flag} /> : null}
          <span className="text-meta text-muted-foreground">Reference {referenceText(alert.result) || "—"}</span>
        </p>
        <p className="text-meta text-muted-foreground">
          Order <span className="font-mono">{alert.orderNumber}</span> · requested by {alert.orderingPractitionerName ?? "—"} · raised{" "}
          {clinicalDateTime(alert.raisedAt)}
        </p>
        {alert.communicatedAt ? (
          <p className="text-table">
            <PhoneIcon className="mr-1 inline size-4" aria-hidden />
            {METHOD_LABEL[alert.communicationMethod ?? "other"]} to {alert.communicatedTo} by {alert.communicatedByName ?? "—"} at{" "}
            {clinicalDateTime(alert.communicatedAt)} · {alert.readBackConfirmed ? "read back confirmed" : "read back NOT confirmed"}
            {alert.communicationNote ? ` · ${alert.communicationNote}` : ""}
          </p>
        ) : null}
        {alert.acknowledgedAt ? (
          <p className="text-table">
            <CheckIcon className="mr-1 inline size-4" aria-hidden />
            Acknowledged by {alert.acknowledgedByName ?? "—"} at {clinicalDateTime(alert.acknowledgedAt)}
          </p>
        ) : null}

        {alert.status === "open" && canCommunicate ? (
          <form
            className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_12rem]"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  communicateCritical({
                    alertId: alert.id,
                    communicatedTo: form.communicatedTo,
                    method: form.method,
                    readBackConfirmed: form.readBack,
                    note: form.note,
                  }),
                "Communication documented",
              );
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor={`to-${alert.id}`}>Told to (name and role) *</Label>
              <Input id={`to-${alert.id}`} value={form.communicatedTo} onChange={(e) => setForm({ ...form, communicatedTo: e.target.value })} maxLength={200} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`method-${alert.id}`}>How</Label>
              <NativeSelect
                id={`method-${alert.id}`}
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value as keyof typeof METHOD_LABEL })}
              >
                {Object.entries(METHOD_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Input
              aria-label="Note"
              placeholder="Note (optional)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              maxLength={1000}
              className="sm:col-span-2"
            />
            <label className="flex items-center gap-2 text-table sm:col-span-2">
              <Checkbox checked={form.readBack} onCheckedChange={(c) => setForm({ ...form, readBack: c === true })} /> The recipient read the value back
            </label>
            <Button type="submit" size="sm" className="self-start" disabled={pending || form.communicatedTo.trim().length < 2}>
              <PhoneIcon /> Document communication
            </Button>
          </form>
        ) : null}
        {alert.status === "open" ? (
          <p className="text-meta text-muted-foreground">Acknowledgement opens once the laboratory has documented telling the care team.</p>
        ) : null}
        {alert.status === "communicated" ? (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={pending}
            onClick={() => run(() => acknowledgeCritical(alert.id), "Acknowledged")}
          >
            <CheckIcon /> Acknowledge
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
