"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertOctagonIcon, FlaskConicalIcon, PlusIcon, XIcon, ZapIcon } from "lucide-react";
import { clinicalDateTime, LabFlagBadge } from "@healthcare/ui/healthcare";
import { Badge, Button, Checkbox, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { LabOrder, LabPanel, LabPriority, LabTest } from "@/lib/api/types";
import { ITEM_STATUS_LABEL, PRIORITY_LABEL, referenceText, resultValue, uiFlag } from "@/lib/lab-mapping";
import { cancelLabOrder, createLabOrder } from "../../../laboratory/actions";

/**
 * Laboratory orders placed during this consultation, with their progress and
 * released results. Results appear here only after the laboratory releases
 * them; flags are the laboratory's interpretation against its reference range.
 */
export function LabOrdersPanel({
  encounterId,
  patientId,
  orders,
  tests,
  panels,
  canOrder,
  canCancel,
  defaultIndication,
}: {
  encounterId: string;
  patientId: string;
  /** null: the user may not read laboratory orders. */
  orders: LabOrder[] | null;
  tests: LabTest[];
  panels: LabPanel[];
  canOrder: boolean;
  canCancel: boolean;
  defaultIndication: string;
}) {
  const [ordering, setOrdering] = React.useState(false);
  if (orders === null) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="lab-orders-heading">
      <div className="flex items-center gap-2">
        <h3 id="lab-orders-heading" className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">
          Laboratory
        </h3>
        {canOrder && !ordering ? (
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setOrdering(true)} disabled={tests.length === 0}>
            <PlusIcon /> Order tests
          </Button>
        ) : null}
      </div>
      {orders.length === 0 && !ordering ? <p className="text-table text-muted-foreground">No laboratory tests ordered in this consultation.</p> : null}
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} canCancel={canCancel} />
      ))}
      {ordering ? (
        <OrderForm
          encounterId={encounterId}
          patientId={patientId}
          tests={tests}
          panels={panels}
          defaultIndication={defaultIndication}
          onDone={() => setOrdering(false)}
        />
      ) : null}
    </section>
  );
}

function OrderCard({ order, canCancel }: { order: LabOrder; canCancel: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const cancellable = order.status === "active" && order.items.every((i) => ["pending_collection", "collected", "received", "cancelled"].includes(i.status));

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-card p-2">
      <p className="flex flex-wrap items-center gap-2 text-table">
        <FlaskConicalIcon className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-mono">{order.orderNumber}</span>
        {order.priority === "stat" ? (
          <Badge variant="critical">
            <ZapIcon aria-hidden /> STAT
          </Badge>
        ) : (
          <span className="text-meta text-muted-foreground">{PRIORITY_LABEL[order.priority]}</span>
        )}
        {order.fastingRequired ? <Badge variant="info">Fasting</Badge> : null}
        <span className="ml-auto text-meta text-muted-foreground">
          {order.status === "cancelled"
            ? `Cancelled: ${order.cancellationReason}`
            : order.status === "completed"
              ? "All results released"
              : clinicalDateTime(order.orderedAt)}
        </span>
      </p>
      <ul className="flex flex-col gap-1">
        {order.items.map((item) => {
          const r = item.result;
          const flag = r ? uiFlag(r.flag) : null;
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-2 text-table">
              <span className={item.status === "cancelled" ? "text-muted-foreground line-through" : undefined}>{item.testName}</span>
              {r ? (
                <>
                  <span className="font-mono font-semibold">{resultValue(r)}</span>
                  {r.unit ? <span className="text-meta text-muted-foreground">{r.unit}</span> : null}
                  {flag ? <LabFlagBadge flag={flag} /> : null}
                  {r.critical ? (
                    <Badge variant="critical">
                      <AlertOctagonIcon aria-hidden /> Critical
                    </Badge>
                  ) : null}
                  <span className="text-meta text-muted-foreground">
                    {referenceText(r) ? `ref ${referenceText(r)}` : ""}
                    {r.versionNumber > 1 ? ` · corrected: ${r.correctionReason}` : ""}
                  </span>
                </>
              ) : (
                <span className="text-meta text-muted-foreground">{ITEM_STATUS_LABEL[item.status]}</span>
              )}
            </li>
          );
        })}
      </ul>
      {canCancel && cancellable ? (
        cancelling ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await cancelLabOrder({ orderId: order.id, reason });
                if (result.ok) {
                  toast.success(`Order ${order.orderNumber} cancelled`);
                  router.refresh();
                } else toast.error(result.message);
              });
            }}
          >
            <Input
              aria-label="Reason for cancelling"
              placeholder="Reason for cancelling"
              className="min-w-56 flex-1"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button type="submit" size="xs" variant="destructive" disabled={pending || reason.trim().length < 3}>
              Cancel order
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setCancelling(false)}>
              Keep
            </Button>
          </form>
        ) : (
          <Button size="xs" variant="ghost" className="self-start" onClick={() => setCancelling(true)}>
            <XIcon /> Cancel order…
          </Button>
        )
      ) : null}
    </div>
  );
}

function OrderForm({
  encounterId,
  patientId,
  tests,
  panels,
  defaultIndication,
  onDone,
}: {
  encounterId: string;
  patientId: string;
  tests: LabTest[];
  panels: LabPanel[];
  defaultIndication: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [filter, setFilter] = React.useState("");
  const [testIds, setTestIds] = React.useState<string[]>([]);
  const [panelIds, setPanelIds] = React.useState<string[]>([]);
  const [priority, setPriority] = React.useState<LabPriority>("routine");
  const [indication, setIndication] = React.useState(defaultIndication);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  // One key per form: a retried submission cannot create a second order.
  const [idempotencyKey] = React.useState(() => crypto.randomUUID());

  const needle = filter.trim().toLowerCase();
  const matches = (name: string, code: string) => !needle || name.toLowerCase().includes(needle) || code.includes(needle);
  const panelTestIds = new Set(panels.filter((p) => panelIds.includes(p.id)).flatMap((p) => p.testIds));
  const fasting = tests.some((t) => t.requiresFasting && (testIds.includes(t.id) || panelTestIds.has(t.id)));
  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const result = await createLabOrder(
        { patientId, encounterId, testIds, panelIds, priority, clinicalIndication: indication, notes: notes || undefined },
        idempotencyKey,
      );
      if (result.ok) {
        toast.success(`Order ${result.data.orderNumber} sent to the laboratory`);
        onDone();
        router.refresh();
      } else setError(result.message);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border p-2.5">
      <Input aria-label="Filter tests" placeholder="Filter tests and panels" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="grid max-h-56 gap-x-4 gap-y-1 overflow-auto sm:grid-cols-2">
        {panels
          .filter((p) => matches(p.name, p.code))
          .map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-table">
              <Checkbox checked={panelIds.includes(p.id)} onCheckedChange={(c) => toggle(panelIds, setPanelIds, p.id, c === true)} />
              <span className="font-medium">{p.name}</span> <span className="text-meta text-muted-foreground">panel · {p.testIds.length}</span>
            </label>
          ))}
        {tests
          .filter((t) => matches(t.name, t.code))
          .map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-table">
              <Checkbox
                checked={testIds.includes(t.id) || panelTestIds.has(t.id)}
                disabled={panelTestIds.has(t.id)}
                onCheckedChange={(c) => toggle(testIds, setTestIds, t.id, c === true)}
              />
              {t.name}
              {t.requiresFasting ? <span className="text-meta text-muted-foreground">fasting</span> : null}
            </label>
          ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <div className="grid gap-1">
          <Label htmlFor="lab-priority">Priority</Label>
          <NativeSelect id="lab-priority" value={priority} onChange={(e) => setPriority(e.target.value as LabPriority)}>
            <option value="routine">Routine</option>
            <option value="stat">STAT</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="lab-indication">Clinical indication</Label>
          <Input id="lab-indication" value={indication} onChange={(e) => setIndication(e.target.value)} maxLength={1000} />
        </div>
      </div>
      <Textarea
        aria-label="Notes to the laboratory"
        placeholder="Notes to the laboratory (optional)"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {fasting ? <p className="text-meta text-info-foreground">Includes tests that need fasting — tell the patient.</p> : null}
      {error ? (
        <p role="alert" className="text-table text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || testIds.length + panelIds.length === 0}>
          <FlaskConicalIcon /> Order {testIds.length + panelTestIds.size || ""} test{testIds.length + panelTestIds.size === 1 ? "" : "s"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
