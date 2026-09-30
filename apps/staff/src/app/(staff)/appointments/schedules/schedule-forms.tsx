"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { PractitionerDetail } from "@/lib/api/types";
import { zonedLocalToIso } from "@/lib/clinic-mapping";
import { addClosure, addPractitioner, addRoom, addSchedule, type PractitionerInput, retireSchedule, updatePractitioner } from "./actions";
import { PROFESSIONS, ROOM_TYPES, WEEKDAYS } from "./labels";

interface Option {
  id: string;
  name: string;
}

/** Runs a server action, reports the outcome and refreshes the page. */
function useSubmit() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const submit = (call: () => Promise<ActionResult<unknown>>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
      } else toast.error(result.message);
      router.refresh();
    });
  return { pending, submit };
}

function Toggle({ label, open, setOpen }: { label: string; open: boolean; setOpen: (v: boolean) => void }) {
  return open ? null : (
    <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
      {label}
    </Button>
  );
}

export function AddSchedule({ facilityId, today, practitioners, rooms }: { facilityId: string; today: string; practitioners: Option[]; rooms: Option[] }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const blank = { practitionerId: "", roomId: "", dayOfWeek: "1", startTime: "08:00", endTime: "12:00", slotMinutes: "15", validFrom: today, validUntil: "" };
  const [form, setForm] = React.useState(blank);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  if (!open) return <Toggle label="Add a weekly schedule…" open={open} setOpen={setOpen} />;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () => addSchedule({ ...form, facilityId }),
          "Schedule added",
          () => {
            setForm(blank);
            setOpen(false);
          },
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1">
          <Label htmlFor="schedule-practitioner">Practitioner</Label>
          <NativeSelect placeholder="Choose…" id="schedule-practitioner" required value={form.practitionerId} onChange={set("practitionerId")}>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="schedule-day">Day</Label>
          <NativeSelect id="schedule-day" value={form.dayOfWeek} onChange={set("dayOfWeek")}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="schedule-start">From</Label>
          <Input id="schedule-start" type="time" required value={form.startTime} onChange={set("startTime")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="schedule-end">To</Label>
          <Input id="schedule-end" type="time" required value={form.endTime} onChange={set("endTime")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="schedule-slot">Slot length (minutes)</Label>
          <Input id="schedule-slot" type="number" min={5} max={240} required value={form.slotMinutes} onChange={set("slotMinutes")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="schedule-room">Room (optional)</Label>
          <NativeSelect emptyText="No rooms set up" id="schedule-room" value={form.roomId} onChange={set("roomId")}>
            <option value="">No room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="schedule-from">First day</Label>
          <Input id="schedule-from" type="date" required value={form.validFrom} onChange={set("validFrom")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="schedule-until">Last day (optional)</Label>
          <Input id="schedule-until" type="date" min={form.validFrom} value={form.validUntil} onChange={set("validUntil")} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add schedule"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Retiring stops the schedule offering new slots; appointments already booked in it stay. */
export function RetireSchedule({ scheduleId, label }: { scheduleId: string; label: string }) {
  const { pending, submit } = useSubmit();
  const [confirming, setConfirming] = React.useState(false);
  if (!confirming) {
    return (
      <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>
        Retire…
      </Button>
    );
  }
  return (
    <span className="ml-auto flex items-center gap-1">
      <span className="text-meta">No new bookings in {label}; booked ones stay.</span>
      <Button size="xs" variant="destructive" disabled={pending} onClick={() => submit(() => retireSchedule(scheduleId), "Schedule retired")}>
        Retire
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </Button>
    </span>
  );
}

export function AddClosure({ facilityId, timeZone, practitioners }: { facilityId: string; timeZone: string; practitioners: Option[] }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const blank = { practitionerId: "", starts: "", ends: "", reason: "" };
  const [form, setForm] = React.useState(blank);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  if (!open) return <Toggle label="Add a closure…" open={open} setOpen={setOpen} />;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.starts || !form.ends) return;
        submit(
          () =>
            addClosure({
              facilityId,
              practitionerId: form.practitionerId,
              startsAt: zonedLocalToIso(form.starts, timeZone),
              endsAt: zonedLocalToIso(form.ends, timeZone),
              reason: form.reason,
            }),
          "Closure added",
          () => {
            setForm(blank);
            setOpen(false);
          },
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1">
          <Label htmlFor="closure-who">Who</Label>
          <NativeSelect emptyText="No practitioners set up" id="closure-who" value={form.practitionerId} onChange={set("practitionerId")}>
            <option value="">Whole facility</option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="closure-start">From</Label>
          <Input id="closure-start" type="datetime-local" required value={form.starts} onChange={set("starts")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="closure-end">Until</Label>
          <Input id="closure-end" type="datetime-local" required min={form.starts} value={form.ends} onChange={set("ends")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="closure-reason">Reason</Label>
          <Input id="closure-reason" required maxLength={300} placeholder="e.g. Holiday, leave, training" value={form.reason} onChange={set("reason")} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add closure"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const BLANK_PRACTITIONER: PractitionerInput = { displayName: "", profession: "physician", specialty: "", licenseNumber: "", licenseValidUntil: "", userId: "" };

function PractitionerFields({
  prefix,
  form,
  set,
  users,
}: {
  prefix: string;
  form: PractitionerInput;
  set: (k: keyof PractitionerInput, v: string) => void;
  users: Option[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${prefix}-name`}>Name as patients see it</Label>
        <Input id={`${prefix}-name`} required maxLength={200} value={form.displayName} onChange={(e) => set("displayName", e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${prefix}-profession`}>Profession</Label>
        <NativeSelect id={`${prefix}-profession`} value={form.profession} onChange={(e) => set("profession", e.target.value)}>
          {PROFESSIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${prefix}-specialty`}>Specialty (optional)</Label>
        <Input id={`${prefix}-specialty`} maxLength={120} value={form.specialty ?? ""} onChange={(e) => set("specialty", e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${prefix}-license`}>Licence number (as issued)</Label>
        <Input id={`${prefix}-license`} maxLength={40} value={form.licenseNumber ?? ""} onChange={(e) => set("licenseNumber", e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${prefix}-valid`}>Licence valid until</Label>
        <Input id={`${prefix}-valid`} type="date" value={form.licenseValidUntil ?? ""} onChange={(e) => set("licenseValidUntil", e.target.value)} />
      </div>
      {users.length > 0 ? (
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor={`${prefix}-user`}>Staff account (to document and prescribe as this practitioner)</Label>
          <NativeSelect emptyText="No staff users" id={`${prefix}-user`} value={form.userId ?? ""} onChange={(e) => set("userId", e.target.value)}>
            <option value="">None</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </div>
  );
}

export function AddPractitioner({ users }: { users: Option[] }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<PractitionerInput>(BLANK_PRACTITIONER);
  if (!open) return <Toggle label="Add a practitioner…" open={open} setOpen={setOpen} />;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () => addPractitioner(form),
          "Practitioner added",
          () => {
            setForm(BLANK_PRACTITIONER);
            setOpen(false);
          },
        );
      }}
    >
      <PractitionerFields prefix="new-practitioner" form={form} users={users} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add practitioner"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function EditPractitioner({ practitioner, users }: { practitioner: PractitionerDetail; users: Option[] }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const initial = () => ({
    displayName: practitioner.displayName,
    profession: practitioner.profession,
    specialty: practitioner.specialty ?? "",
    licenseNumber: practitioner.licenseNumber ?? "",
    licenseValidUntil: practitioner.licenseValidUntil ?? "",
    userId: practitioner.userId ?? "",
    status: practitioner.status,
  });
  const [form, setForm] = React.useState(initial);
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          setForm(initial());
          setOpen(true);
        }}
      >
        Edit…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit {practitioner.displayName}</DialogTitle>
            <DialogDescription>An inactive practitioner cannot be booked; their past records stay as they are.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(
                () => updatePractitioner(practitioner.id, { ...form, version: practitioner.version }),
                "Practitioner saved",
                () => setOpen(false),
              );
            }}
          >
            <PractitionerFields prefix={`edit-${practitioner.id}`} form={form} users={users} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
            <div className="grid gap-1 sm:max-w-48">
              <Label htmlFor={`edit-${practitioner.id}-status`}>Status</Label>
              <NativeSelect
                id={`edit-${practitioner.id}-status`}
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "active" | "inactive" }))}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </NativeSelect>
            </div>
            <Button type="submit" size="sm" disabled={pending} className="self-start">
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AddRoom({ facilityId }: { facilityId: string }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const blank = { code: "", name: "", roomType: "consultation" };
  const [form, setForm] = React.useState(blank);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  if (!open) return <Toggle label="Add a room…" open={open} setOpen={setOpen} />;
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () => addRoom({ ...form, facilityId }),
          "Room added",
          () => {
            setForm(blank);
            setOpen(false);
          },
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="room-name">Name</Label>
        <Input id="room-name" required maxLength={120} value={form.name} onChange={set("name")} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="room-code">Code</Label>
        <Input
          id="room-code"
          required
          placeholder="e.g. consult-1"
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="room-type">Type</Label>
        <NativeSelect id="room-type" value={form.roomType} onChange={set("roomType")}>
          {ROOM_TYPES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add room"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </Button>
    </form>
  );
}
