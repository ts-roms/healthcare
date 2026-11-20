"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, PasswordInput, toast } from "@healthcare/ui/primitives";
import { FACILITY_TYPES } from "../../admin/facilities/facility-types";
import { createTenant } from "../actions";

/**
 * A new organization with its first facility and administrator. The administrator's temporary password is needed only
 * when the email is new to the platform; they replace it at their first sign-in. An existing staff account keeps its
 * own password and is added as the organization's administrator.
 */
export function NewTenantForm() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({
    code: "",
    name: "",
    facilityCode: "main",
    facilityName: "Main Clinic",
    facilityType: "clinic",
    cityMunicipality: "",
    province: "",
    adminEmail: "",
    adminName: "",
    temporaryPassword: "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createTenant({
            code: form.code,
            name: form.name,
            facility: {
              code: form.facilityCode,
              name: form.facilityName,
              facilityType: form.facilityType,
              cityMunicipality: form.cityMunicipality,
              province: form.province,
            },
            administrator: { email: form.adminEmail, displayName: form.adminName, temporaryPassword: form.temporaryPassword },
          });
          if (result.ok) {
            toast.success(`${result.data.name} created`);
            router.push(`/platform/${result.data.id}`);
          } else {
            toast.error(result.message);
          }
        });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" required maxLength={200} value={form.name} onChange={set("name")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="org-code">Code (permanent; patients type it to sign in to MyHealth)</Label>
            <Input id="org-code" required maxLength={49} value={form.code} onChange={set("code")} placeholder="e.g. sta-cruz-clinic" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>First facility</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="fac-name">Name</Label>
            <Input id="fac-name" required maxLength={200} value={form.facilityName} onChange={set("facilityName")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="fac-code">Code</Label>
            <Input id="fac-code" required maxLength={49} value={form.facilityCode} onChange={set("facilityCode")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="fac-type">Type</Label>
            <NativeSelect id="fac-type" value={form.facilityType} onChange={set("facilityType")}>
              {FACILITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="fac-city">City / municipality</Label>
            <Input id="fac-city" maxLength={120} value={form.cityMunicipality} onChange={set("cityMunicipality")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="fac-province">Province</Label>
            <Input id="fac-province" maxLength={120} value={form.province} onChange={set("province")} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>First administrator</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="admin-name">Name</Label>
            <Input id="admin-name" required maxLength={200} value={form.adminName} onChange={set("adminName")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="admin-email">Email</Label>
            <Input id="admin-email" type="email" required maxLength={254} value={form.adminEmail} onChange={set("adminEmail")} />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="admin-password">Temporary password (only if this email has no account yet)</Label>
            <PasswordInput id="admin-password" autoComplete="new-password" maxLength={200} value={form.temporaryPassword} onChange={set("temporaryPassword")} />
            <p className="text-meta text-muted-foreground">
              At least 12 characters, checked against known breached passwords. Give it to the person yourself; they choose their own at the first sign-in. An
              existing account keeps its password and is only made this organization&apos;s administrator.
            </p>
          </div>
        </CardContent>
      </Card>
      <div>
        <Button type="submit" disabled={pending}>
          Create organization
        </Button>
      </div>
    </form>
  );
}
