"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import type { Organization } from "@/lib/api/types";
import { renameOrganization } from "./actions";

export function OrganizationForm({ organization }: { organization: Organization }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(organization.name);
  const unchanged = name.trim() === organization.name;
  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await renameOrganization({ name, version: organization.version });
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
      <Button type="submit" disabled={pending || unchanged} className="self-start">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
