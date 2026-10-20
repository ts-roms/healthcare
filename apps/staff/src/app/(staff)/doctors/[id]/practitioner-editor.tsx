"use client";

import * as React from "react";
import { PencilIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Label, NativeSelect } from "@healthcare/ui/primitives";
import type { PractitionerDetail } from "@/lib/api/types";
import { useServerAction } from "@/lib/use-server-action";
import { updatePractitioner } from "../../appointments/schedules/actions";
import { PractitionerFields } from "../../appointments/schedules/schedule-forms";

const OpenEditor = React.createContext<(() => void) | null>(null);

/**
 * The one dialog that edits this practitioner's profile (name, profession, specialty, licence, staff account, status): the
 * "Edit profile" button and the setup steps of the page all open it. The same fields and action as the practitioners list
 * of the schedules page; the API checks `clinic.configure` and the version either way.
 */
export function PractitionerEditor({
  practitioner,
  users,
  children,
}: {
  practitioner: PractitionerDetail;
  users: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const { pending, run } = useServerAction({ refreshOnFailure: true });
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
  const show = React.useCallback(() => {
    setForm(initial());
    setOpen(true);
    // `initial` reads the practitioner as it is when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practitioner]);
  return (
    <OpenEditor.Provider value={show}>
      {children}
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
              run(
                () => updatePractitioner(practitioner.id, { ...form, version: practitioner.version }),
                "Profile saved",
                () => setOpen(false),
              );
            }}
          >
            <PractitionerFields prefix="profile" form={form} users={users} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
            <div className="grid gap-1 sm:max-w-48">
              <Label htmlFor="profile-status">Status</Label>
              <NativeSelect
                id="profile-status"
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
    </OpenEditor.Provider>
  );
}

function useOpenEditor(): () => void {
  const open = React.useContext(OpenEditor);
  if (!open) throw new Error("Use inside PractitionerEditor");
  return open;
}

/** "Edit profile" in the page header. */
export function EditProfileButton() {
  const open = useOpenEditor();
  return (
    <Button variant="outline" onClick={open}>
      <PencilIcon /> Edit profile
    </Button>
  );
}

/** A step or a missing credential that is fixed in the edit dialog, drawn as a chip (`variant="chip"`) or an inline link. */
export function EditStep({ children, variant = "link" }: { children: React.ReactNode; variant?: "chip" | "link" }) {
  const open = useOpenEditor();
  return (
    <button
      type="button"
      onClick={open}
      className={
        variant === "chip"
          ? "rounded-md border bg-card px-3 py-1.5 text-table font-medium text-foreground outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50"
          : "rounded text-left text-body font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      }
    >
      {children}
    </button>
  );
}
