"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Button, Card, Input, Label, NativeSelect } from "@healthcare/ui/primitives";
import { useServerAction } from "@/lib/use-server-action";
import { registerDevice } from "./actions";

export interface DeviceAccount {
  id: string;
  label: string;
  /** The built-in role the account holds: `kiosk_device` or `queue_display`. */
  role: "kiosk_device" | "queue_display";
}

/**
 * Registers a kiosk or a waiting-room screen. The account it signs in with must hold that device's role at this facility
 * (and nothing that opens patient records): the API checks it, and only accounts that hold the role are offered here.
 */
export function RegisterDevice({ accounts }: { accounts: DeviceAccount[] }) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<"kiosk" | "display">("kiosk");
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const { pending, run } = useServerAction();
  const offered = accounts.filter((a) => a.role === (kind === "kiosk" ? "kiosk_device" : "queue_display"));

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} className="self-start">
        <PlusIcon /> Register a device
      </Button>
    );
  }
  return (
    <Card className="p-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => registerDevice({ kind, code, name, userId }),
            `${name.trim()} registered`,
            () => {
              setOpen(false);
              setCode("");
              setName("");
              setUserId("");
            },
          );
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor="device-kind">Kind</Label>
          <NativeSelect
            id="device-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as "kiosk" | "display");
              setUserId("");
            }}
          >
            <option value="kiosk">Kiosk</option>
            <option value="display">Waiting-room screen</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="device-code">Code</Label>
          <Input id="device-code" value={code} maxLength={40} placeholder="front-1" onChange={(e) => setCode(e.target.value)} className="w-40 font-mono" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="device-name">Name</Label>
          <Input id="device-name" value={name} maxLength={100} placeholder="Front kiosk" onChange={(e) => setName(e.target.value)} className="w-56" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="device-account">Account it signs in with</Label>
          <NativeSelect
            id="device-account"
            value={userId}
            placeholder="Choose…"
            emptyText="No accounts with that role"
            onChange={(e) => setUserId(e.target.value)}
          >
            {offered.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" size="sm" disabled={pending || !code.trim() || name.trim().length < 2 || !userId}>
          Register
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <p className="basis-full text-meta text-muted-foreground">
          Create the account first in Administration → Users, with the <strong>{kind === "kiosk" ? "Patient kiosk" : "Waiting-room display"}</strong> role at
          this facility.
        </p>
      </form>
    </Card>
  );
}
