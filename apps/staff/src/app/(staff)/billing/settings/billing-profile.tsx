"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { BillingCategory, BillingPackage, BillingService, BillingSettingsFull, SequenceKind, TaxProfile, VatStatus } from "@/lib/api/types";
import { CATEGORY_LABEL, parsePesos, peso } from "@/lib/billing-mapping";
import { todayIn } from "@/lib/clinic-mapping";
import { createPackage, updatePrefixes, updateTaxProfile } from "../actions";

const SERIES_LABEL: Record<SequenceKind, string> = { invoice: "Invoices", receipt: "Receipts", credit_note: "Credit notes", debit_note: "Debit notes" };
const VAT_STATUS_LABEL: Record<VatStatus, string> = { not_configured: "Not configured", vat_registered: "VAT-registered", non_vat: "Non-VAT" };

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

/** Number series: prefixes and, optionally, the last number the organization is authorized to use. */
export function DocumentNumbers({ settings, canManage }: { settings: BillingSettingsFull; canManage: boolean }) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState({
    invoicePrefix: settings.invoicePrefix,
    receiptPrefix: settings.receiptPrefix,
    creditNotePrefix: settings.creditNotePrefix,
    debitNotePrefix: settings.debitNotePrefix,
  });
  const [limits, setLimits] = React.useState<Record<SequenceKind, string>>(
    () => Object.fromEntries(settings.series.map((s) => [s.kind, s.lastValue === null ? "" : String(s.lastValue)])) as Record<SequenceKind, string>,
  );
  const prefixKey: Record<SequenceKind, keyof typeof f> = {
    invoice: "invoicePrefix",
    receipt: "receiptPrefix",
    credit_note: "creditNotePrefix",
    debit_note: "debitNotePrefix",
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Document numbers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        <ul className="flex flex-col gap-1 text-table">
          {settings.series.map((s) => (
            <li key={s.kind} className="flex justify-between gap-2">
              <span>{SERIES_LABEL[s.kind]}</span>
              <span className="font-mono">
                {s.prefix}-YYYY-{String(s.nextValue).padStart(6, "0")} next
                {s.lastValue !== null ? ` · last authorized ${s.lastValue}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {canManage ? (
          <form
            className="grid grid-cols-[1fr_6rem_7rem] items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const lastNumbers = Object.fromEntries(
                settings.series.map((s) => [s.kind, limits[s.kind].trim() === "" ? null : Number(limits[s.kind].replace(/\D/g, ""))]),
              );
              submit(() => updatePrefixes({ ...f, lastNumbers }), "Document numbers saved");
            }}
          >
            <span className="text-meta text-muted-foreground">Series</span>
            <span className="text-meta text-muted-foreground">Prefix</span>
            <span className="text-meta text-muted-foreground">Last number</span>
            {settings.series.map((s) => (
              <React.Fragment key={s.kind}>
                <Label htmlFor={`prefix-${s.kind}`}>{SERIES_LABEL[s.kind]}</Label>
                <Input
                  id={`prefix-${s.kind}`}
                  value={f[prefixKey[s.kind]]}
                  maxLength={12}
                  onChange={(e) => setF({ ...f, [prefixKey[s.kind]]: e.target.value.toUpperCase() })}
                />
                <Input
                  aria-label={`Last authorized number for ${SERIES_LABEL[s.kind]}`}
                  inputMode="numeric"
                  placeholder="No limit"
                  value={limits[s.kind]}
                  onChange={(e) => setLimits({ ...limits, [s.kind]: e.target.value.replace(/\D/g, "") })}
                />
              </React.Fragment>
            ))}
            <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
              Save
            </Button>
          </form>
        ) : null}
        <p className="text-meta text-muted-foreground">
          When the last authorized number is reached, nothing more is issued in that series until the next range is entered. The format, numbering and
          authorized ranges BIR requires for your organization must be confirmed before production use.
        </p>
      </CardContent>
    </Card>
  );
}

/** The organization's own tax and document settings — what its registration says; nothing is assumed. */
export function TaxProfileCard({ profile, canManage }: { profile: TaxProfile; canManage: boolean }) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState({
    registeredName: profile.registeredName ?? "",
    tin: profile.tin ?? "",
    businessAddress: profile.businessAddress ?? "",
    vatStatus: profile.vatStatus,
    vatRate: profile.vatRateBp === null ? "" : String(profile.vatRateBp / 100),
    permitReference: profile.permitReference ?? "",
    documentNote: profile.documentNote ?? "",
    depositsAcrossFacilities: profile.depositsAcrossFacilities,
  });
  const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax and documents</CardTitle>
        <span className="ml-auto">
          <Badge variant={profile.vatStatus === "not_configured" ? "warning" : "neutral"}>{VAT_STATUS_LABEL[profile.vatStatus]}</Badge>
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        <p className="flex gap-2 rounded-md border border-warning/40 bg-warning-subtle p-2 text-table text-warning-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Enter these as your BIR registration and your accountant say. The platform does not know BIR rules: VAT treatment (including of statutory discounts),
          document format and wording must be confirmed before production use.
        </p>
        {canManage ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const rate = f.vatStatus === "vat_registered" ? Math.round(Number(f.vatRate) * 100) : null;
              if (f.vatStatus === "vat_registered" && (!rate || rate < 1 || rate > 10_000)) {
                toast.error("Enter the VAT rate in percent, as registered.");
                return;
              }
              submit(
                () =>
                  updateTaxProfile({
                    registeredName: orNull(f.registeredName),
                    tin: orNull(f.tin),
                    businessAddress: orNull(f.businessAddress),
                    vatStatus: f.vatStatus,
                    vatRateBp: rate,
                    permitReference: orNull(f.permitReference),
                    documentNote: orNull(f.documentNote),
                    depositsAcrossFacilities: f.depositsAcrossFacilities,
                    version: profile.version || undefined,
                  }),
                "Tax and document settings saved",
              );
            }}
          >
            <Label htmlFor="tax-name">Registered name</Label>
            <Input id="tax-name" value={f.registeredName} maxLength={200} onChange={(e) => setF({ ...f, registeredName: e.target.value })} />
            <Label htmlFor="tax-tin">TIN (as registered)</Label>
            <Input id="tax-tin" value={f.tin} maxLength={20} onChange={(e) => setF({ ...f, tin: e.target.value })} placeholder="000-000-000-00000" />
            <Label htmlFor="tax-address">Registered address</Label>
            <Input id="tax-address" value={f.businessAddress} maxLength={300} onChange={(e) => setF({ ...f, businessAddress: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="tax-vat">VAT status</Label>
                <NativeSelect id="tax-vat" value={f.vatStatus} onChange={(e) => setF({ ...f, vatStatus: e.target.value as VatStatus })}>
                  {(Object.keys(VAT_STATUS_LABEL) as VatStatus[]).map((v) => (
                    <option key={v} value={v}>
                      {VAT_STATUS_LABEL[v]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tax-rate">VAT rate (%)</Label>
                <Input
                  id="tax-rate"
                  inputMode="decimal"
                  disabled={f.vatStatus !== "vat_registered"}
                  value={f.vatRate}
                  onChange={(e) => setF({ ...f, vatRate: e.target.value })}
                  placeholder="As registered"
                />
              </div>
            </div>
            <Label htmlFor="tax-permit">Permit reference (e.g. ATP or CAS permit, as issued)</Label>
            <Input id="tax-permit" value={f.permitReference} maxLength={120} onChange={(e) => setF({ ...f, permitReference: e.target.value })} />
            <Label htmlFor="tax-note">Text printed on invoices</Label>
            <Input id="tax-note" value={f.documentNote} maxLength={500} onChange={(e) => setF({ ...f, documentNote: e.target.value })} />
            <label className="flex items-center gap-2 text-table">
              <Checkbox checked={f.depositsAcrossFacilities} onCheckedChange={(v) => setF({ ...f, depositsAcrossFacilities: v === true })} />
              Patients&apos; deposits and credit can be used at any of our facilities
            </label>
            <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
              Save
            </Button>
          </form>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-table">
            <dt className="text-muted-foreground">Registered name</dt>
            <dd>{profile.registeredName ?? "—"}</dd>
            <dt className="text-muted-foreground">TIN</dt>
            <dd>{profile.tin ?? "—"}</dd>
            <dt className="text-muted-foreground">Deposits across facilities</dt>
            <dd>{profile.depositsAcrossFacilities ? "Yes" : "No"}</dd>
          </dl>
        )}
        <p className="text-meta text-muted-foreground">
          When VAT-registered, every service invoiced needs a VAT class (Services and prices), and each issued invoice records its VAT breakdown.
        </p>
      </CardContent>
    </Card>
  );
}

type PackageRow = { key: string; serviceId: string; quantity: string };

/** Packages: a price and the services included; contents are fixed once created (a changed package is a new one). */
export function Packages({ packages, services, canManage }: { packages: BillingPackage[]; services: BillingService[]; canManage: boolean }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const blank = (): PackageRow => ({ key: crypto.randomUUID(), serviceId: "", quantity: "1" });
  const [f, setF] = React.useState({ code: "", name: "", category: "consultation" as BillingCategory, price: "", validity: "", from: todayIn("Asia/Manila") });
  const [rows, setRows] = React.useState<PackageRow[]>(() => [blank()]);
  const included = services.filter((s) => s.status === "active" && !packages.some((p) => p.id === s.id));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Packages</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-body">
        {packages.length === 0 ? <p className="text-muted-foreground">No packages.</p> : null}
        <ul className="flex flex-col gap-2">
          {packages.map((p) => (
            <li key={p.id} className={p.status === "inactive" ? "opacity-60" : undefined}>
              <span className="flex justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="tabular-nums">{p.currentPrice !== null ? peso(p.currentPrice) : "—"}</span>
              </span>
              <span className="block text-meta text-muted-foreground">
                {p.items.map((i) => `${i.serviceName}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`).join(", ")}
                {p.packageValidityDays ? ` · usable ${p.packageValidityDays} days` : ""}
                {p.status === "inactive" ? " · no longer sold" : ""}
              </span>
            </li>
          ))}
        </ul>
        {canManage ? (
          open ? (
            <form
              className="grid gap-2 rounded-lg border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const price = parsePesos(f.price);
                if (price === null) {
                  toast.error("Enter the package price in pesos");
                  return;
                }
                submit(
                  () =>
                    createPackage({
                      code: f.code,
                      name: f.name,
                      category: f.category,
                      unitPrice: price,
                      effectiveFrom: f.from,
                      validityDays: f.validity ? Number(f.validity) : undefined,
                      items: rows.filter((r) => r.serviceId).map((r) => ({ serviceId: r.serviceId, quantity: Number(r.quantity) || 1 })),
                    }),
                  "Package created",
                  () => {
                    setOpen(false);
                    setRows([blank()]);
                  },
                );
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label="Code" placeholder="code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
                <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
                <NativeSelect aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as BillingCategory })}>
                  {(Object.keys(CATEGORY_LABEL) as BillingCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  aria-label="Price (₱)"
                  inputMode="decimal"
                  placeholder="Price ₱"
                  value={f.price}
                  onChange={(e) => setF({ ...f, price: e.target.value })}
                />
                <Input
                  aria-label="Usable for days"
                  inputMode="numeric"
                  placeholder="Usable for days (optional)"
                  value={f.validity}
                  onChange={(e) => setF({ ...f, validity: e.target.value.replace(/\D/g, "") })}
                />
                <Input aria-label="Price from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
              </div>
              <span className="text-meta text-muted-foreground">Includes</span>
              {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-[1fr_4rem_auto] gap-2">
                  <NativeSelect
                    aria-label="Included service"
                    value={r.serviceId}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, serviceId: e.target.value } : x)))}
                  >
                    <option value="">Choose…</option>
                    {included.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label="Quantity"
                    inputMode="numeric"
                    value={r.quantity}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x)))}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove"
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
              <Button type="button" size="xs" variant="outline" className="justify-self-start" onClick={() => setRows((rs) => [...rs, blank()])}>
                <PlusIcon /> Service
              </Button>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  Create package
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
              <PlusIcon /> New package
            </Button>
          )
        ) : null}
        <p className="text-meta text-muted-foreground">
          Sold from the patient&apos;s billing page. Included services charged at that facility are then covered at ₱0 until used up.
        </p>
      </CardContent>
    </Card>
  );
}
