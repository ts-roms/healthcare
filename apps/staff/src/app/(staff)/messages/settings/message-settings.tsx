"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import type { MessageTopic, PatientMessageSetting } from "@/lib/api/types";
import { TOPIC_LABEL, TOPIC_OPTIONS } from "@/lib/messaging-mapping";
import { saveMessageSetting } from "../actions";

type RouteKind = "everyone" | "role" | "user";

function routeKind(setting: PatientMessageSetting | undefined): RouteKind {
  if (setting?.routeUserId) return "user";
  if (setting?.routeRoleKey) return "role";
  return "everyone";
}

/** Routing and response target per topic at the selected facility; the API validates, versions and audits each save. */
export function MessageSettings({
  facilityId,
  facilityName,
  settings,
  roles,
  users,
  directory,
  canConfigure,
}: {
  facilityId: string;
  facilityName: string;
  settings: PatientMessageSetting[];
  roles: Array<{ key: string; name: string }>;
  users: Array<{ id: string; displayName: string }>;
  directory: boolean;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [topic, setTopic] = React.useState<MessageTopic>("general");
  const current = settings.find((s) => s.topic === topic);
  const [kind, setKind] = React.useState<RouteKind>(routeKind(current));
  const [roleKey, setRoleKey] = React.useState(current?.routeRoleKey ?? "");
  const [userId, setUserId] = React.useState(current?.routeUserId ?? "");
  const [autoAssign, setAutoAssign] = React.useState(current?.autoAssign ?? false);
  const [hours, setHours] = React.useState(current?.responseTargetHours ? String(current.responseTargetHours) : "");
  const [pending, startTransition] = React.useTransition();

  const choose = (next: MessageTopic) => {
    const setting = settings.find((s) => s.topic === next);
    setTopic(next);
    setKind(routeKind(setting));
    setRoleKey(setting?.routeRoleKey ?? "");
    setUserId(setting?.routeUserId ?? "");
    setAutoAssign(setting?.autoAssign ?? false);
    setHours(setting?.responseTargetHours ? String(setting.responseTargetHours) : "");
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveMessageSetting({
        facilityId,
        topic,
        routeRoleKey: kind === "role" ? roleKey : undefined,
        routeUserId: kind === "user" ? userId : undefined,
        autoAssign: kind === "user" && autoAssign,
        responseTargetHours: hours ? Number(hours) : null,
        version: current?.version,
      });
      if (!result.ok) return void toast.error(result.message);
      toast.success(`Saved for ${TOPIC_LABEL[topic]}`);
      router.refresh();
    });
  };

  const describe = (s: PatientMessageSetting) =>
    s.routeUserId
      ? `${s.routeUserName ?? "One person"}${s.autoAssign ? " (assigned on arrival)" : ""}`
      : s.routeRoleKey
        ? `Role: ${roles.find((r) => r.key === s.routeRoleKey)?.name ?? s.routeRoleKey}`
        : "Everyone who can reply";

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="py-0">
        <CardHeader className="pt-4">
          <CardTitle>{facilityName}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead>Goes to</TableHead>
                <TableHead>Answer within</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TOPIC_OPTIONS.map((t) => {
                const s = settings.find((x) => x.topic === t.value);
                return (
                  <TableRow key={t.value} aria-current={t.value === topic ? "true" : undefined}>
                    <TableCell>
                      <Button type="button" size="xs" variant={t.value === topic ? "default" : "ghost"} onClick={() => choose(t.value)}>
                        {t.label}
                      </Button>
                    </TableCell>
                    <TableCell className="text-table">{s ? describe(s) : "Everyone who can reply"}</TableCell>
                    <TableCell className="text-table">{s?.responseTargetHours ? `${s.responseTargetHours} hours` : "No target"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {canConfigure ? (
        <Card>
          <CardHeader>
            <CardTitle>{TOPIC_LABEL[topic]}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="route-kind">New messages go to</Label>
                <NativeSelect id="route-kind" value={kind} onChange={(e) => setKind(e.target.value as RouteKind)}>
                  <option value="everyone">Everyone who can reply at this facility</option>
                  <option value="role">Everyone with a role</option>
                  <option value="user">One person</option>
                </NativeSelect>
              </div>
              {kind === "role" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="route-role">Role</Label>
                  {directory ? (
                    <NativeSelect id="route-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)} placeholder="Choose…" required>
                      {roles.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input
                      id="route-role"
                      value={roleKey}
                      onChange={(e) => setRoleKey(e.target.value)}
                      placeholder="Role key, e.g. receptionist"
                      pattern="[a-z0-9_]{1,60}"
                      required
                    />
                  )}
                  <p className="text-meta text-muted-foreground">Only people with the role who may also reply are told.</p>
                </div>
              ) : null}
              {kind === "user" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="route-user">Person</Label>
                  {directory ? (
                    <NativeSelect
                      id="route-user"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      placeholder="Choose…"
                      emptyText="No staff listed"
                      required
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input id="route-user" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User id" required />
                  )}
                  <Label className="flex items-center gap-2 text-table font-normal">
                    <Checkbox checked={autoAssign} onCheckedChange={(v) => setAutoAssign(v === true)} />
                    Assign new conversations to this person on arrival
                  </Label>
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                <Label htmlFor="target-hours">Answer within (hours, 1–168; empty = no target)</Label>
                <Input id="target-hours" type="number" min={1} max={168} step={1} value={hours} onChange={(e) => setHours(e.target.value)} />
                <p className="text-meta text-muted-foreground">
                  Calendar hours from the patient&apos;s message; clinic hours and holidays are not taken into account.
                </p>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" size="sm" disabled={pending || (kind === "role" && !roleKey) || (kind === "user" && !userId)}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="text-table text-muted-foreground">Only people who may configure the clinic change these settings.</p>
      )}
    </div>
  );
}
