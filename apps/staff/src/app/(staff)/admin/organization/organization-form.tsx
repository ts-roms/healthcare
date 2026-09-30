"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Label, toast } from "@healthcare/ui/primitives";
import type { Organization } from "@/lib/api/types";
import { renameOrganization } from "./actions";

export function OrganizationForm({ organization }: { organization: Organization }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(organization.name);
  const [mfaRequired, setMfaRequired] = React.useState(organization.staffMfaRequired);
  const unchanged = name.trim() === organization.name && mfaRequired === organization.staffMfaRequired;
  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await renameOrganization({ name, staffMfaRequired: mfaRequired, version: organization.version });
          if (result.ok) {
            toast.success("Company settings saved");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="organization-name">Organization name</Label>
        <Input id="organization-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="organization-code">Identifier</Label>
        <Input id="organization-code" readOnly value={organization.code} />
        <p className="text-meta text-muted-foreground">Set when the organization was created; it cannot be changed.</p>
      </div>
      <div className="grid gap-1">
        <span className="text-table font-medium">Staff sign-in</span>
        <label className="flex items-center gap-2 text-body">
          <Checkbox
            checked={mfaRequired}
            onCheckedChange={(checked) => setMfaRequired(checked === true)}
            aria-label="Require two-step verification for all staff"
          />
          Require two-step verification for all staff
        </label>
        <p className="text-meta text-muted-foreground">
          Staff without it are asked to set it up at their next page and can do nothing else until they have; nobody can turn it off while this is on. Set yours
          up first under My account.
        </p>
      </div>
      <Button type="submit" disabled={pending || unchanged} className="self-start">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
