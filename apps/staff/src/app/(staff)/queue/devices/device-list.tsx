"use client";

import * as React from "react";
import { MonitorIcon, MonitorSmartphoneIcon, PencilIcon, PrinterIcon, TriangleAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@healthcare/ui/primitives";
import type { KioskDevice } from "@/lib/api/types";
import {
  DEVICE_HEALTH_LABEL,
  DEVICE_HEALTH_VARIANT,
  DEVICE_STATUS_LABEL,
  PRINTER_LABEL,
  PRINTER_STATUS_DETAIL,
  PRINTER_VARIANT,
  printerWhere,
} from "@/lib/kiosk-devices";
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
                        {d.printsTickets ? <span className="block text-meta text-muted-foreground">{printerWhere(d)}</span> : null}
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
  const [connection, setConnection] = React.useState(device.printerConnection);
  const [host, setHost] = React.useState(device.printerHost ?? "");
  const [port, setPort] = React.useState(device.printerPort ? String(device.printerPort) : "");
  const [paperMm, setPaperMm] = React.useState<58 | 80>(device.paperMm);
  const [networks, setNetworks] = React.useState(device.allowedNetworks.join("\n"));
  const networkList = networks
    .split(/[\s,]+/)
    .map((n) => n.trim())
    .filter(Boolean);
  const networksChanged = networkList.join(",") !== device.allowedNetworks.join(",");
  const portNumber = port.trim() === "" ? null : Number(port);
  const printerChanged =
    connection !== device.printerConnection ||
    paperMm !== device.paperMm ||
    (connection === "network" && (host.trim() !== (device.printerHost ?? "") || portNumber !== device.printerPort));
  const printerReady =
    connection === "agent_local" ||
    (host.trim().length > 0 && (portNumber === null || (Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535)));
  const changed =
    name.trim() !== device.name ||
    status !== device.status ||
    printsTickets !== device.printsTickets ||
    agentId !== (device.printAgentUserId ?? "") ||
    printerChanged ||
    networksChanged;
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
                  ...(printerChanged
                    ? connection === "network"
                      ? { printerConnection: "network" as const, printerHost: host.trim(), printerPort: portNumber, paperMm }
                      : { printerConnection: "agent_local" as const, paperMm }
                    : {}),
                  ...(networksChanged ? { allowedNetworks: networkList } : {}),
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
          {device.kind === "kiosk" ? (
            <fieldset className="grid basis-full gap-3 rounded-lg border p-3">
              <legend className="px-1 text-meta font-medium text-muted-foreground">Printer</legend>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid shrink-0 gap-1">
                  <label htmlFor={`connection-${device.id}`} className="text-meta text-muted-foreground">
                    Where is the printer?
                  </label>
                  <NativeSelect
                    id={`connection-${device.id}`}
                    value={connection}
                    onChange={(e) => setConnection(e.target.value as KioskDevice["printerConnection"])}
                    className="w-80 max-w-full"
                  >
                    <option value="agent_local">Connected to the agent&apos;s computer</option>
                    <option value="network">On the clinic&apos;s network</option>
                  </NativeSelect>
                </div>
                {connection === "network" ? (
                  <>
                    <div className="grid shrink-0 gap-1">
                      <label htmlFor={`host-${device.id}`} className="text-meta text-muted-foreground">
                        Printer address
                      </label>
                      <Input
                        id={`host-${device.id}`}
                        value={host}
                        maxLength={253}
                        placeholder="192.168.1.50"
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => setHost(e.target.value)}
                        className="w-52 font-mono"
                      />
                    </div>
                    <div className="grid shrink-0 gap-1">
                      <label htmlFor={`port-${device.id}`} className="text-meta text-muted-foreground">
                        Port
                      </label>
                      <Input
                        id={`port-${device.id}`}
                        inputMode="numeric"
                        value={port}
                        maxLength={5}
                        placeholder="9100"
                        onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                        className="w-24 font-mono"
                      />
                    </div>
                  </>
                ) : null}
                <div className="grid shrink-0 gap-1">
                  <label htmlFor={`paper-${device.id}`} className="text-meta text-muted-foreground">
                    Paper width
                  </label>
                  <NativeSelect id={`paper-${device.id}`} value={String(paperMm)} onChange={(e) => setPaperMm(e.target.value === "58" ? 58 : 80)}>
                    <option value="80">80 mm</option>
                    <option value="58">58 mm</option>
                  </NativeSelect>
                </div>
              </div>
              <p className="text-meta text-muted-foreground">
                {connection === "network"
                  ? "The printer must be on the clinic's own network (an address like 192.168.1.50, or a local name); the port is usually 9100. "
                  : "Which printer that is, is set on the agent's computer, not here. "}
                The print agent picks up a change within a minute; nothing needs changing on its computer.
              </p>
            </fieldset>
          ) : null}
          {device.kind === "kiosk" ? (
            <fieldset className="grid basis-full gap-2 rounded-lg border p-3">
              <legend className="px-1 text-meta font-medium text-muted-foreground">Where this kiosk may be used</legend>
              <label htmlFor={`networks-${device.id}`} className="text-meta text-muted-foreground">
                Allowed networks (optional)
              </label>
              <Textarea
                id={`networks-${device.id}`}
                value={networks}
                rows={3}
                spellCheck={false}
                autoCapitalize="none"
                placeholder={"203.0.113.7\n203.0.113.0/24"}
                onChange={(e) => setNetworks(e.target.value)}
                className="max-w-md font-mono"
              />
              <p className="text-meta text-muted-foreground">
                The clinic&apos;s own internet addresses, one per line (an address, or a range such as 203.0.113.0/24), up to 10. Leave empty to allow the kiosk
                anywhere. Requests from any other network are refused and recorded in the audit trail. Ask your internet provider for the clinic&apos;s fixed
                address.
              </p>
            </fieldset>
          ) : null}
          <Button type="submit" size="sm" disabled={pending || !changed || name.trim().length < 2 || !printerReady}>
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
