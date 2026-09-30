"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { FacilityDetail } from "@/lib/api/types";
import { createDepartment, createFacility, updateFacility, type FacilityDetailsInput } from "./actions";
import { FACILITY_TYPES } from "./facility-types";

const EMPTY: FacilityDetailsInput = {
  name: "",
  facilityType: "clinic",
  addressLine: "",
  barangay: "",
  cityMunicipality: "",
  province: "",
  region: "",
  postalCode: "",
  contactNumber: "",
  email: "",
  licenseNumber: "",
};

const TEXT_FIELDS: Array<{ key: keyof FacilityDetailsInput; label: string; max: number; type?: string }> = [
  { key: "addressLine", label: "Street address", max: 300 },
  { key: "barangay", label: "Barangay", max: 120 },
  { key: "cityMunicipality", label: "City / municipality", max: 120 },
  { key: "province", label: "Province", max: 120 },
  { key: "region", label: "Region", max: 120 },
  { key: "postalCode", label: "Postal code", max: 4 },
  { key: "contactNumber", label: "Contact number", max: 40 },
  { key: "email", label: "Email", max: 200, type: "email" },
  { key: "licenseNumber", label: "Licence number (as issued)", max: 80 },
];

function DetailsFields({ prefix, form, set }: { prefix: string; form: FacilityDetailsInput; set: (key: keyof FacilityDetailsInput, value: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${prefix}-name`}>Name</Label>
        <Input id={`${prefix}-name`} required maxLength={200} value={form.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${prefix}-type`}>Type</Label>
        <NativeSelect id={`${prefix}-type`} value={form.facilityType} onChange={(e) => set("facilityType", e.target.value)}>
          {FACILITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {TEXT_FIELDS.map((field) => (
        <div key={field.key} className="grid gap-1">
          <Label htmlFor={`${prefix}-${field.key}`}>{field.label}</Label>
          <Input
            id={`${prefix}-${field.key}`}
            type={field.type ?? "text"}
            maxLength={field.max}
            value={(form[field.key] as string | undefined) ?? ""}
            onChange={(e) => set(field.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

export function NewFacility() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [code, setCode] = React.useState("");
  const [form, setForm] = React.useState<FacilityDetailsInput>(EMPTY);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        New facility
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New facility</DialogTitle>
            <DialogDescription>A clinic, laboratory or other site. Its time zone is Asia/Manila.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await createFacility({ ...form, code });
                if (result.ok) {
                  toast.success(`${result.data.name} added`);
                  setOpen(false);
                  setForm(EMPTY);
                  setCode("");
                  router.refresh();
                } else toast.error(result.message);
              });
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="new-facility-code">Code</Label>
              <Input
                id="new-facility-code"
                required
                placeholder="e.g. main-clinic"
                pattern="[a-z0-9][a-z0-9\-]{1,48}"
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase())}
              />
            </div>
            <DetailsFields prefix="new-facility" form={form} set={(key, value) => setForm((f) => ({ ...f, [key]: value }))} />
            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Adding…" : "Add facility"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EditFacility({ facility }: { facility: FacilityDetail }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const initial = (): FacilityDetailsInput & { status: "active" | "inactive" } => ({
    name: facility.name,
    facilityType: facility.facilityType,
    addressLine: facility.addressLine ?? "",
    barangay: facility.barangay ?? "",
    cityMunicipality: facility.cityMunicipality ?? "",
    province: facility.province ?? "",
    region: facility.region ?? "",
    postalCode: facility.postalCode ?? "",
    contactNumber: facility.contactNumber ?? "",
    email: facility.email ?? "",
    licenseNumber: facility.licenseNumber ?? "",
    status: facility.status === "inactive" ? "inactive" : "active",
  });
  const [form, setForm] = React.useState(initial);
  if (facility.status !== "active" && facility.status !== "inactive") return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setForm(initial());
          setOpen(true);
        }}
      >
        Edit…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {facility.name}</DialogTitle>
            <DialogDescription>
              The code <code>{facility.code}</code> does not change. An inactive facility no longer appears in the facility selector.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await updateFacility(facility.id, { ...form, version: facility.version });
                if (result.ok) {
                  toast.success("Facility saved");
                  setOpen(false);
                } else toast.error(result.message);
                router.refresh();
              });
            }}
          >
            <DetailsFields prefix={`edit-${facility.id}`} form={form} set={(key, value) => setForm((f) => ({ ...f, [key]: value }))} />
            <div className="grid gap-1 sm:max-w-60">
              <Label htmlFor={`edit-${facility.id}-status`}>Status</Label>
              <NativeSelect
                id={`edit-${facility.id}-status`}
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "active" | "inactive" }))}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </NativeSelect>
            </div>
            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NewDepartment({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({ code: "", name: "" });
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add department…
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2 rounded-md border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createDepartment(facilityId, form);
          if (result.ok) {
            toast.success(`${result.data.name} added`);
            setOpen(false);
            setForm({ code: "", name: "" });
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`dept-name-${facilityId}`}>Name</Label>
        <Input id={`dept-name-${facilityId}`} required maxLength={200} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`dept-code-${facilityId}`}>Code</Label>
        <Input
          id={`dept-code-${facilityId}`}
          required
          placeholder="e.g. laboratory"
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))}
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </Button>
    </form>
  );
}
