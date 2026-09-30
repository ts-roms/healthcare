"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import {
  Badge,
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
import type { InventoryCategory, InventoryItem, InventoryLocation, InventorySupplier } from "@/lib/api/types";
import { INVENTORY_CATEGORY_LABEL as CATEGORY } from "@/lib/inventory-mapping";
import { createItem, createLocation, createSupplier, setReorderLevel } from "../actions";

function useSubmit() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const submit = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });
  return { pending, submit };
}

export function InventoryCatalog({
  items,
  suppliers,
  locations,
  facility,
}: {
  items: InventoryItem[];
  suppliers: InventorySupplier[];
  locations: InventoryLocation[];
  facility: { id: string; name: string } | null;
}) {
  const here = facility ? locations.filter((l) => l.facilityId === facility.id) : [];
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <Items items={items} />
        {facility ? <ReorderLevels items={items} locations={here} /> : null}
      </div>
      <div className="flex flex-col gap-4">
        <Locations locations={locations} facility={facility} />
        <Suppliers suppliers={suppliers} />
      </div>
    </div>
  );
}

function Items({ items }: { items: InventoryItem[] }) {
  const { pending, submit } = useSubmit();
  const empty = { code: "", name: "", category: "medicine" as InventoryCategory, stockUnit: "", tracksLots: true, controlled: false };
  const [f, setF] = React.useState(empty);
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Items</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Stock unit</TableHead>
                <TableHead>Tracking</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    {i.name} <span className="text-meta text-muted-foreground">· {i.code}</span>
                    {i.status === "inactive" ? (
                      <Badge className="ml-2" variant="neutral">
                        Inactive
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{CATEGORY[i.category]}</TableCell>
                  <TableCell>{i.stockUnit}</TableCell>
                  <TableCell className="text-meta">
                    {i.tracksLots ? "Lot and expiry" : "Quantity only"}
                    {i.controlled ? " · controlled" : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-4 text-muted-foreground">No items yet.</p>
        )}
        <form
          className="grid gap-2 px-4 sm:grid-cols-4 sm:items-end"
          aria-label="Add an item"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () => createItem(f),
              `${f.name} added`,
              () => setF(empty),
            );
          }}
        >
          <Field id="item-code" label="Code">
            <Input id="item-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field id="item-name" label="Name">
            <Input id="item-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field id="item-category" label="Category">
            <NativeSelect id="item-category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as InventoryCategory })}>
              {Object.entries(CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="item-unit" label="Stock unit">
            <Input id="item-unit" placeholder="tablet, vial, box…" value={f.stockUnit} onChange={(e) => setF({ ...f, stockUnit: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-body sm:col-span-2">
            <Checkbox checked={f.tracksLots} onCheckedChange={(v) => setF({ ...f, tracksLots: v === true })} /> Track lot numbers and expiry
          </label>
          <label className="flex items-center gap-2 text-body">
            <Checkbox checked={f.controlled} onCheckedChange={(v) => setF({ ...f, controlled: v === true })} /> Controlled item
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            <PlusIcon /> Add item
          </Button>
        </form>
        <p className="px-4 text-meta text-muted-foreground">
          Controlled items need a reason and a reference on every movement. The official register for dangerous drugs is a compliance dependency, not
          implemented here.
        </p>
      </CardContent>
    </Card>
  );
}

function ReorderLevels({ items, locations }: { items: InventoryItem[]; locations: InventoryLocation[] }) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState({ locationId: locations[0]?.id ?? "", itemId: "", level: "", quantity: "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reorder levels</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-2 sm:grid-cols-5 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                setReorderLevel({
                  locationId: f.locationId,
                  itemId: f.itemId,
                  reorderLevel: Number.parseInt(f.level, 10),
                  reorderQuantity: f.quantity ? Number.parseInt(f.quantity, 10) : null,
                }),
              "Reorder level saved",
            );
          }}
        >
          <Field id="rl-location" label="Location">
            <NativeSelect id="rl-location" value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rl-item" label="Item">
            <NativeSelect placeholder="Choose…" id="rl-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rl-level" label="Reorder at (usable units)">
            <Input id="rl-level" inputMode="numeric" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field id="rl-quantity" label="Usually order (optional)">
            <Input id="rl-quantity" inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Button type="submit" size="sm" disabled={pending || !f.itemId || !f.level || !f.locationId}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Locations({ locations, facility }: { locations: InventoryLocation[]; facility: { id: string; name: string } | null }) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState({ code: "", name: "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage locations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-body">
        <ul className="flex flex-col gap-1">
          {locations.map((l) => (
            <li key={l.id}>
              {l.name} <span className="text-meta text-muted-foreground">· {l.code}</span>
              {facility && l.facilityId !== facility.id ? <span className="text-meta text-muted-foreground"> · other facility</span> : null}
            </li>
          ))}
        </ul>
        {facility ? (
          <form
            className="grid grid-cols-2 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(
                () => createLocation({ facilityId: facility.id, ...f }),
                `${f.name} added`,
                () => setF({ code: "", name: "" }),
              );
            }}
          >
            <Field id="loc-code" label="Code">
              <Input id="loc-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>
            <Field id="loc-name" label="Name">
              <Input id="loc-name" placeholder="Pharmacy, lab store…" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
              <PlusIcon /> Add at {facility.name}
            </Button>
          </form>
        ) : (
          <p className="text-meta text-muted-foreground">Select a facility to add a location.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Suppliers({ suppliers }: { suppliers: InventorySupplier[] }) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState({ code: "", name: "", contact: "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Suppliers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-body">
        <ul className="flex flex-col gap-1">
          {suppliers.map((s) => (
            <li key={s.id}>
              {s.name} <span className="text-meta text-muted-foreground">· {s.code}</span>
            </li>
          ))}
        </ul>
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () => createSupplier({ ...f, contact: f.contact || undefined }),
              `${f.name} added`,
              () => setF({ code: "", name: "", contact: "" }),
            );
          }}
        >
          <Field id="sup-code" label="Code">
            <Input id="sup-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field id="sup-name" label="Name">
            <Input id="sup-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field id="sup-contact" label="Contact (optional)" wide>
            <Input id="sup-contact" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
          </Field>
          <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
            <PlusIcon /> Add supplier
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, wide, children }: { id: string; label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? "col-span-2" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
