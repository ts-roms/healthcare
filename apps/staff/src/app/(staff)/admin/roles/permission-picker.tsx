"use client";

import { Checkbox, Label } from "@healthcare/ui/primitives";

/** The grouped permission checkboxes of a role form; permissions the administrator does not hold are shown but cannot be ticked or unticked. */
export function PermissionPicker({
  idPrefix,
  groups,
  held,
  chosen,
  onToggle,
}: {
  idPrefix: string;
  groups: Array<{ area: string; permissions: string[] }>;
  held: string[];
  chosen: Set<string>;
  onToggle: (permission: string, on: boolean) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-table font-medium">Permissions ({chosen.size} chosen)</legend>
      <p className="text-meta text-muted-foreground">Greyed-out permissions are ones you do not hold; you cannot hand them out or take them away.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <div key={group.area} className="rounded-md border p-2">
            <p className="mb-1 text-meta font-medium text-muted-foreground uppercase">{group.area}</p>
            {group.permissions.map((permission) => {
              const id = `${idPrefix}-${permission}`;
              const allowed = held.includes(permission);
              return (
                <div key={permission} className="flex items-center gap-2 py-0.5">
                  <Checkbox id={id} disabled={!allowed} checked={chosen.has(permission)} onCheckedChange={(v) => onToggle(permission, v === true)} />
                  <Label htmlFor={id} className={allowed ? "font-mono text-meta" : "font-mono text-meta text-muted-foreground"}>
                    {permission}
                  </Label>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
