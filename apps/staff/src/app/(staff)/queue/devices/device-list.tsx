"use client";

import * as React from "react";
import { MonitorIcon, MonitorSmartphoneIcon, PencilIcon, PrinterIcon, TriangleAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Checkbox, Input, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { KioskDevice } from "@/lib/api/types";
import { DEVICE_HEALTH_LABEL, DEVICE_HEALTH_VARIANT, DEVICE_STATUS_LABEL, PRINTER_LABEL, PRINTER_STATUS_DETAIL, PRINTER_VARIANT } from "@/lib/kiosk-devices";
import { useServerAction } from "@/lib/use-server-action";
import type { DeviceAccount } from "./register-device";
import { updateDevice } from "./actions";

/**
 * The facility's kiosks and waiting-room displays: whether each is reporting, when it last did, its version and (for a
 * kiosk) whether its printer is working. Text with an icon, never colour alone.
 */
export function DeviceList({ devices, canManage, agents }: { devices: KioskDevice[]; canManage: boolean; agents: DeviceAccount[] }) {
  const [editing, setEditing] = React.useState<string | null>(null);
  return (
    <Card className="py-0">
      {devices.length === 0 ? (
        <p className="p-4 text-body text-muted-foreground">No kiosks or screens are registered at this facility yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead>Printer</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((d) =>
              editing === d.id ? (
                <EditRow key={d.id} device={d} agents={agents} onDone={() => setEditing(null)} />
              ) : (
                <TableRow key={d.id}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      {d.kind === "kiosk" ? <MonitorSmartphoneIcon className="size-4" aria-hidden /> : <MonitorIcon className="size-4" aria-hidden />}
                      {d.name}
                    </span>
                    <span className="block text-meta text-muted-foreground">
                      {d.kind === "kiosk" ? "Kiosk" : "Waiting-room screen"} · <span className="font-mono">{d.code}</span>
                      {d.appVersion ? ` · v${d.appVersion}` : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={DEVICE_HEALTH_VARIANT[d.health]}>{DEVICE_HEALTH_LABEL[d.health]}</Badge>
                  </TableCell>
                  <TableCell className="text-table">
                    {d.heartbeatAt ? clinicalDateTime(d.heartbeatAt) : <span className="text-muted-foreground">Never</span>}
                  </TableCell>
                  <TableCell>
                    {d.kind === "display" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        <Badge variant={PRINTER_VARIANT[d.printer]}>
                          {d.printer === "attention" || d.printer === "unavailable" ? <TriangleAlertIcon aria-hidden /> : <PrinterIcon aria-hidden />}
                          {PRINTER_LABEL[d.printer]}
                        </Badge>
                        {d.printer !== "none" && d.printer !== "unknown" ? (
                          <span className="block text-meta text-muted-foreground">
                            {PRINTER_STATUS_DETAIL[d.printerStatus]}
                            {d.printerHeartbeatAt ? ` · ${clinicalDateTime(d.printerHeartbeatAt)}` : ""}
                          </span>
                        ) : null}
                      </>
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button size="xs" variant="outline" onClick={() => setEditing(d.id)} aria-label={`Edit ${d.name}`}>
                        <PencilIcon /> Edit
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function EditRow({ device, agents, onDone }: { device: KioskDevice; agents: DeviceAccount[]; onDone: () => void }) {
  const [name, setName] = React.useState(device.name);
  const [status, setStatus] = React.useState<KioskDevice["status"]>(device.status);
  const { pending, run } = useServerAction();
  const [printsTickets, setPrintsTickets] = React.useState(device.printsTickets);
  const [agentId, setAgentId] = React.useState(device.printAgentUserId ?? "");
  const changed =
    name.trim() !== device.name || status !== device.status || printsTickets !== device.printsTickets || agentId !== (device.printAgentUserId ?? "");
  return (
    <TableRow>
      <TableCell colSpan={5}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                updateDevice({
                  deviceId: device.id,
                  version: device.version,
                  ...(name.trim() !== device.name ? { name: name.trim() } : {}),
                  ...(status !== device.status ? { status } : {}),
                  ...(printsTickets !== device.printsTickets ? { printsTickets } : {}),
                  ...(agentId !== (device.printAgentUserId ?? "") ? { printAgentUserId: agentId || null } : {}),
                }),
              `${device.name} updated`,
              onDone,
            );
          }}
        >
          <div className="grid shrink-0 gap-1">
            <label htmlFor={`name-${device.id}`} className="text-meta text-muted-foreground">
              Name
            </label>
            <Input id={`name-${device.id}`} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className="w-64" />
          </div>
          <div className="grid shrink-0 gap-1">
            <label htmlFor={`status-${device.id}`} className="text-meta text-muted-foreground">
              Status
            </label>
            <NativeSelect id={`status-${device.id}`} value={status} onChange={(e) => setStatus(e.target.value as KioskDevice["status"])}>
              {(Object.keys(DEVICE_STATUS_LABEL) as Array<KioskDevice["status"]>).map((s) => (
                <option key={s} value={s}>
                  {DEVICE_STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          {device.kind === "kiosk" ? (
            <div className="flex items-center gap-2 pb-2">
              <Checkbox id={`prints-${device.id}`} checked={printsTickets} onCheckedChange={(v) => setPrintsTickets(v === true)} />
              <label htmlFor={`prints-${device.id}`} className="text-meta">
                Prints tickets
              </label>
            </div>
          ) : null}
          {device.kind === "kiosk" ? (
            <div className="grid shrink-0 gap-1">
              <label htmlFor={`agent-${device.id}`} className="text-meta text-muted-foreground">
                Print agent
              </label>
              <NativeSelect
                id={`agent-${device.id}`}
                value={agentId}
                emptyText="No print agent accounts set up"
                onChange={(e) => setAgentId(e.target.value)}
                className="w-64"
              >
                <option value="">Any print agent of this facility</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <Button type="submit" size="sm" disabled={pending || !changed || name.trim().length < 2}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </form>
      </TableCell>
    </TableRow>
  );
}
