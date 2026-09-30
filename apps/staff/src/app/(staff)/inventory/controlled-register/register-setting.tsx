"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import type { ControlledRegisterSetting } from "@/lib/api/types";
import { setControlledRegisterSetting } from "../actions";

/** The facility's register header, as the organization records it (not verified). */
export function RegisterSettingForm({ setting }: { setting: ControlledRegisterSetting }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [f, setF] = React.useState({
    licenceReference: setting.licenceReference ?? "",
    responsiblePerson: setting.responsiblePerson ?? "",
    note: setting.note ?? "",
  });
  return (
    <form
      className="grid gap-2 sm:grid-cols-3 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await setControlledRegisterSetting({ ...f, version: setting.version });
          if (result.ok) {
            toast.success("Register details saved");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="reg-licence">Licence reference</Label>
        <Input id="reg-licence" maxLength={80} value={f.licenceReference} onChange={(e) => setF({ ...f, licenceReference: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="reg-person">Responsible person and licence number</Label>
        <Input id="reg-person" maxLength={160} value={f.responsiblePerson} onChange={(e) => setF({ ...f, responsiblePerson: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="reg-note">Note (optional)</Label>
        <Input id="reg-note" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      <Button type="submit" size="sm" className="self-start sm:col-span-3" disabled={pending}>
        Save register details
      </Button>
    </form>
  );
}
