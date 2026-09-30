"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PackageIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { SupplyOptions } from "@/lib/api/types";

type TemplateLine = { itemId: string; quantity: number };

/**
 * Supply templates (dental procedure types, clinic procedure catalogue): the inventory items and quantities a procedure
 * usually uses. Configuration only — staff confirm (and change) what was used after each procedure, and it is issued
 * from the facility's stock then.
 */
export function SupplyTemplates({
  options,
  procedures,
  templateOf,
  canManage,
  onSave,
}: {
  options: Pick<SupplyOptions, "items">;
  procedures: Array<{ id: string; name: string }>;
  templateOf: (procedureId: string) => TemplateLine[];
  canManage: boolean;
  onSave: (procedureId: string, items: TemplateLine[]) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<TemplateLine[]>([]);
  const itemName = new Map(options.items.map((i) => [i.id, `${i.name} (${i.stockUnit})`]));

  const act = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(done);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <PackageIcon className="mr-1 inline size-4" aria-hidden /> Supplies per procedure
        </CardTitle>
        <span className="ml-auto text-meta text-muted-foreground">A starting list — staff confirm what was used each time</span>
      </CardHeader>
      <CardContent>
        {procedures.length === 0 ? <p className="text-body text-muted-foreground">Add procedures first.</p> : null}
        <ul className="divide-y text-table" aria-label="Supply templates">
          {procedures.map((t) => {
            const lines = templateOf(t.id);
            return (
              <li key={t.id} className="flex flex-col gap-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{t.name}</span>
                  <span className="text-meta text-muted-foreground">
                    {lines.length ? lines.map((l) => `${itemName.get(l.itemId) ?? "Inactive item"} × ${l.quantity}`).join(" · ") : "No supplies listed"}
                  </span>
                  {canManage && editing !== t.id ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setEditing(t.id);
                        setDraft(lines.filter((l) => itemName.has(l.itemId)));
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
                {editing === t.id ? (
                  <div className="flex flex-col gap-2 rounded-md border p-2">
                    {draft.map((line, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-2">
                        <NativeSelect
                          placeholder="Choose an inventory item…"
                          aria-label={`Supply ${index + 1}`}
                          className="min-w-56 flex-1"
                          value={line.itemId}
                          onChange={(e) => setDraft((d) => d.map((l, i) => (i === index ? { ...l, itemId: e.target.value } : l)))}
                        >
                          {options.items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.stockUnit})
                            </option>
                          ))}
                        </NativeSelect>
                        <Input
                          aria-label={`Quantity of supply ${index + 1}`}
                          type="number"
                          min={1}
                          max={1000}
                          className="w-24"
                          value={line.quantity}
                          onChange={(e) => setDraft((d) => d.map((l, i) => (i === index ? { ...l, quantity: Number(e.target.value) } : l)))}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove supply ${index + 1}`}
                          onClick={() => setDraft((d) => d.filter((_, i) => i !== index))}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                    {options.items.length === 0 ? <p className="text-meta text-muted-foreground">No active inventory items yet.</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDraft((d) => [...d, { itemId: "", quantity: 1 }])}>
                        <PlusIcon /> Add supply
                      </Button>
                      <Button
                        size="sm"
                        disabled={pending || draft.some((l) => !l.itemId || l.quantity < 1)}
                        onClick={() =>
                          act(
                            () => onSave(t.id, draft),
                            `Supplies for ${t.name} saved`,
                            () => setEditing(null),
                          )
                        }
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
