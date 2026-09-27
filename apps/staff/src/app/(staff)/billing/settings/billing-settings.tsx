"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, PlusIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
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
import type { BillingCategory, BillingPayer, BillingService, DiscountRule, PhilHealthAccreditation } from "@/lib/api/types";
import { CATEGORY_LABEL, parsePesos, percent, peso } from "@/lib/billing-mapping";
import { todayIn } from "@/lib/clinic-mapping";
import {
  addPrice,
  createDiscountRule,
  createPayer,
  createService,
  deactivateDiscountRule,
  recordAccreditation,
  setServiceStatus,
  updatePrefixes,
} from "../actions";

type Source = { code: string; name: string };
const CATEGORIES = Object.keys(CATEGORY_LABEL) as BillingCategory[];
const PAYER_TYPES: Record<BillingPayer["payerType"], string> = {
  hmo: "HMO",
  philhealth: "PhilHealth",
  insurance: "Insurance",
  company: "Company",
  other: "Other",
};
const RULE_KINDS: Record<DiscountRule["kind"], string> = {
  senior_citizen: "Senior citizen",
  pwd: "Person with disability",
  employee: "Employee",
  promotional: "Promotional",
  other: "Other",
};

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

export function BillingSettings({
  services,
  payers,
  rules,
  prefixes,
  visitTypes,
  labTests,
  canManage,
  philhealth,
}: {
  services: BillingService[];
  payers: BillingPayer[];
  rules: DiscountRule[];
  prefixes: { invoicePrefix: string; receiptPrefix: string };
  visitTypes: Source[];
  labTests: Source[];
  canManage: boolean;
  /** The selected facility's PhilHealth accreditation (only for staff who may record it). */
  philhealth: { facilityId: string; facilityName: string; accreditation: PhilHealthAccreditation | null } | null;
}) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <Services services={services} visitTypes={visitTypes} labTests={labTests} canManage={canManage} />
        <Rules rules={rules} canManage={canManage} />
      </div>
      <div className="flex flex-col gap-4">
        <Payers payers={payers} canManage={canManage} />
        <Prefixes prefixes={prefixes} canManage={canManage} />
        {philhealth ? <Accreditation {...philhealth} /> : null}
      </div>
    </div>
  );
}

function Services({ services, visitTypes, labTests, canManage }: { services: BillingService[]; visitTypes: Source[]; labTests: Source[]; canManage: boolean }) {
  const { pending, submit } = useSubmit();
  const sourceName = (s: BillingService) => {
    if (!s.sourceKind) return "Added by staff";
    const list = s.sourceKind === "visit_type" ? visitTypes : labTests;
    const name = list.find((x) => x.code === s.sourceCode)?.name ?? s.sourceCode;
    return s.sourceKind === "visit_type" ? `Signed visit: ${name}` : `Lab order: ${name}`;
  };
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Services and prices</CardTitle>
        <span className="ml-auto text-meta text-muted-foreground">New prices apply from their date; billed charges keep their price</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {services.length === 0 ? (
          <p className="px-4 text-body text-muted-foreground">No services yet. Nothing is charged automatically until you add them.</p>
        ) : null}
        {services.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Charged on</TableHead>
                <TableHead className="text-right">Price today</TableHead>
                <TableHead>Upcoming</TableHead>
                {canManage ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((s) => {
                const upcoming = s.prices.filter((p) => p.effectiveFrom > todayIn("Asia/Manila"));
                return (
                  <TableRow key={s.id} className={s.status === "inactive" ? "opacity-60" : undefined}>
                    <TableCell>
                      <span className="font-medium">{s.name}</span>
                      <span className="block text-meta text-muted-foreground">
                        {s.code} · {CATEGORY_LABEL[s.category]}
                        {s.status === "inactive" ? " · inactive" : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-table">{sourceName(s)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.currentPrice !== null ? peso(s.currentPrice) : "—"}</TableCell>
                    <TableCell className="text-table">
                      {upcoming.map((p) => (
                        <span key={p.id} className="block">
                          {peso(p.unitPrice)} from {clinicalDate(p.effectiveFrom)}
                        </span>
                      ))}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <span className="flex justify-end gap-1">
                          <NewPrice service={s} />
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              submit(
                                () => setServiceStatus({ serviceId: s.id, status: s.status === "active" ? "inactive" : "active", version: s.version }),
                                s.status === "active" ? `${s.name} deactivated` : `${s.name} activated`,
                              )
                            }
                          >
                            {s.status === "active" ? "Deactivate" : "Activate"}
                          </Button>
                        </span>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
        {canManage ? <NewService visitTypes={visitTypes} labTests={labTests} /> : null}
      </CardContent>
    </Card>
  );
}

function NewPrice({ service }: { service: BillingService }) {
  const { pending, submit } = useSubmit();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [from, setFrom] = React.useState(todayIn("Asia/Manila"));
  if (!open) {
    return (
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
        New price
      </Button>
    );
  }
  const centavos = parsePesos(amount);
  return (
    <span className="flex items-center gap-1">
      <Input
        aria-label={`New price for ${service.name} (₱)`}
        className="h-7 w-24"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="₱"
      />
      <Input aria-label="Effective from" className="h-7 w-36" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Button
        type="button"
        size="xs"
        disabled={pending || centavos === null}
        onClick={() =>
          submit(
            () => addPrice({ serviceId: service.id, unitPrice: centavos ?? 0, effectiveFrom: from }),
            "Price added",
            () => setOpen(false),
          )
        }
      >
        Save
      </Button>
    </span>
  );
}

function NewService({ visitTypes, labTests }: { visitTypes: Source[]; labTests: Source[] }) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState({
    code: "",
    name: "",
    category: "consultation" as BillingCategory,
    sourceKind: "",
    sourceCode: "",
    price: "",
    from: todayIn("Asia/Manila"),
  });
  const options = f.sourceKind === "visit_type" ? visitTypes : f.sourceKind === "lab_test" ? labTests : [];
  const centavos = parsePesos(f.price);
  return (
    <form
      className="mx-4 grid gap-2 rounded-lg border p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (centavos === null) {
          toast.error("Enter the price in pesos, e.g. 500.00");
          return;
        }
        submit(
          () =>
            createService({
              code: f.code,
              name: f.name,
              category: f.category,
              sourceKind: f.sourceKind === "visit_type" || f.sourceKind === "lab_test" ? f.sourceKind : undefined,
              sourceCode: f.sourceKind ? f.sourceCode : undefined,
              unitPrice: centavos,
              effectiveFrom: f.from,
            }),
          `${f.name} added`,
          () => setF({ ...f, code: "", name: "", sourceCode: "", price: "" }),
        );
      }}
    >
      <p className="font-medium sm:col-span-3">
        <PlusIcon className="mr-1 inline size-4" aria-hidden /> Add a service
      </p>
      <Input aria-label="Code" placeholder="Code, e.g. consult" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
      <Input aria-label="Name" placeholder="Name on the invoice" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <NativeSelect aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as BillingCategory })}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABEL[c]}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Charged automatically" value={f.sourceKind} onChange={(e) => setF({ ...f, sourceKind: e.target.value, sourceCode: "" })}>
        <option value="">Only when added by staff</option>
        <option value="visit_type">When a visit of a type is signed</option>
        <option value="lab_test">When a laboratory test is ordered</option>
      </NativeSelect>
      {f.sourceKind ? (
        options.length ? (
          <NativeSelect aria-label="Visit type or test" value={f.sourceCode} onChange={(e) => setF({ ...f, sourceCode: e.target.value })} required>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Input
            aria-label="Visit type or test code"
            placeholder="Code"
            value={f.sourceCode}
            onChange={(e) => setF({ ...f, sourceCode: e.target.value })}
            required
          />
        )
      ) : (
        <span />
      )}
      <span className="flex gap-2">
        <Input
          aria-label="Price (₱)"
          inputMode="decimal"
          placeholder="Price ₱"
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
          required
        />
        <Input aria-label="Price from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
      </span>
      <Button type="submit" size="sm" className="justify-self-start sm:col-span-3" disabled={pending}>
        Add service
      </Button>
    </form>
  );
}

function Rules({ rules, canManage }: { rules: DiscountRule[]; canManage: boolean }) {
  const { pending, submit } = useSubmit();
  const blank = {
    code: "",
    name: "",
    kind: "senior_citizen" as DiscountRule["kind"],
    statutory: true,
    rate: "20",
    categories: [] as BillingCategory[],
    stackable: false,
    from: todayIn("Asia/Manila"),
  };
  const [f, setF] = React.useState(blank);
  const rateBp = Math.round(Number(f.rate) * 100);
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Discount rules</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        <p className="mx-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-subtle p-2 text-table text-warning-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Statutory discounts (Senior Citizen — RA 9994; PWD — RA 10754): confirm the rate, covered services, VAT treatment and whether discounts combine
          against current official issuances before use. Nothing is preset.
        </p>
        {rules.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>From</TableHead>
                {canManage ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} className={r.status === "inactive" ? "opacity-60" : undefined}>
                  <TableCell>
                    <span className="font-medium">{r.name}</span> {r.statutory ? <Badge variant="info">Statutory</Badge> : null}
                    <span className="block text-meta text-muted-foreground">
                      {RULE_KINDS[r.kind]}
                      {r.requiresEvidence ? " · ID number required" : ""}
                      {r.stackable ? " · combines with others" : ""}
                      {r.status === "inactive" ? " · inactive" : ""}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{percent(r.rateBp)}</TableCell>
                  <TableCell className="text-table">{r.categories.length ? r.categories.map((c) => CATEGORY_LABEL[c]).join(", ") : "Everything"}</TableCell>
                  <TableCell>{clinicalDate(r.effectiveFrom)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {r.status === "active" ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => submit(() => deactivateDiscountRule({ ruleId: r.id }), `${r.name} deactivated`)}
                        >
                          Deactivate
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-4 text-body text-muted-foreground">No discount rules.</p>
        )}
        {canManage ? (
          <form
            className="mx-4 grid gap-2 rounded-lg border p-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(
                () =>
                  createDiscountRule({
                    code: f.code,
                    name: f.name,
                    kind: f.kind,
                    statutory: f.statutory,
                    rateBp,
                    categories: f.categories,
                    requiresEvidence: f.statutory || f.kind === "senior_citizen" || f.kind === "pwd",
                    stackable: f.stackable,
                    effectiveFrom: f.from,
                  }),
                `${f.name} added`,
                () => setF(blank),
              );
            }}
          >
            <p className="font-medium sm:col-span-3">
              <PlusIcon className="mr-1 inline size-4" aria-hidden /> Add a discount rule
            </p>
            <Input aria-label="Code" placeholder="Code, e.g. senior" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
            <Input aria-label="Name" placeholder="Name on the invoice" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            <NativeSelect aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as DiscountRule["kind"] })}>
              {(Object.keys(RULE_KINDS) as DiscountRule["kind"][]).map((k) => (
                <option key={k} value={k}>
                  {RULE_KINDS[k]}
                </option>
              ))}
            </NativeSelect>
            <span className="flex items-center gap-2">
              <Input
                aria-label="Rate (%)"
                inputMode="decimal"
                className="w-20"
                value={f.rate}
                onChange={(e) => setF({ ...f, rate: e.target.value })}
                required
              />
              %
            </span>
            <Input aria-label="Effective from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            <span className="flex flex-col gap-1 text-table">
              <label className="flex items-center gap-2">
                <Checkbox checked={f.statutory} onCheckedChange={(v) => setF({ ...f, statutory: v === true })} /> Statutory (ID number required)
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={f.stackable} onCheckedChange={(v) => setF({ ...f, stackable: v === true })} /> Combines with other discounts
              </label>
            </span>
            <fieldset className="flex flex-wrap gap-3 text-table sm:col-span-3">
              <legend className="mb-1 text-meta text-muted-foreground">Applies to (none ticked = everything)</legend>
              {CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-1.5">
                  <Checkbox
                    checked={f.categories.includes(c)}
                    onCheckedChange={(v) => setF({ ...f, categories: v === true ? [...f.categories, c] : f.categories.filter((x) => x !== c) })}
                  />
                  {CATEGORY_LABEL[c]}
                </label>
              ))}
            </fieldset>
            <Button type="submit" size="sm" className="justify-self-start sm:col-span-3" disabled={pending || !(rateBp > 0 && rateBp <= 10_000)}>
              Add rule
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Payers({ payers, canManage }: { payers: BillingPayer[]; canManage: boolean }) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState({ code: "", name: "", payerType: "hmo" as BillingPayer["payerType"] });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {payers.length === 0 ? <p className="text-body text-muted-foreground">No HMOs or other payers yet.</p> : null}
        <ul className="flex flex-col gap-1 text-body">
          {payers.map((p) => (
            <li key={p.id} className="flex justify-between gap-2">
              <span className="font-medium">{p.name}</span>
              <Badge variant="neutral">{PAYER_TYPES[p.payerType]}</Badge>
            </li>
          ))}
        </ul>
        {canManage ? (
          <form
            className="grid grid-cols-2 gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(
                () => createPayer(f),
                `${f.name} added`,
                () => setF({ code: "", name: "", payerType: "hmo" }),
              );
            }}
          >
            <Input aria-label="Payer code" placeholder="Code, e.g. maxicare" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
            <NativeSelect aria-label="Payer type" value={f.payerType} onChange={(e) => setF({ ...f, payerType: e.target.value as BillingPayer["payerType"] })}>
              {(Object.keys(PAYER_TYPES) as BillingPayer["payerType"][]).map((t) => (
                <option key={t} value={t}>
                  {PAYER_TYPES[t]}
                </option>
              ))}
            </NativeSelect>
            <Input
              aria-label="Payer name"
              className="col-span-2"
              placeholder="Name"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              required
            />
            <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
              Add payer
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Prefixes({ prefixes, canManage }: { prefixes: { invoicePrefix: string; receiptPrefix: string }; canManage: boolean }) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState(prefixes);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Document numbers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        <p className="text-meta text-muted-foreground">
          Invoices are numbered {prefixes.invoicePrefix}-YYYY-000001 and payment receipts {prefixes.receiptPrefix}-YYYY-000001. The format BIR requires for your
          facility must be confirmed before production use.
        </p>
        {canManage ? (
          <form
            className="grid grid-cols-2 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(() => updatePrefixes(f), "Prefixes saved");
            }}
          >
            <Label htmlFor="invoice-prefix">Invoice prefix</Label>
            <Label htmlFor="receipt-prefix">Receipt prefix</Label>
            <Input id="invoice-prefix" value={f.invoicePrefix} maxLength={12} onChange={(e) => setF({ ...f, invoicePrefix: e.target.value.toUpperCase() })} />
            <Input id="receipt-prefix" value={f.receiptPrefix} maxLength={12} onChange={(e) => setF({ ...f, receiptPrefix: e.target.value.toUpperCase() })} />
            <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
              Save
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The facility's PhilHealth accreditation number, as issued (not verified with PhilHealth), used when claims are prepared. */
function Accreditation({
  facilityId,
  facilityName,
  accreditation,
}: {
  facilityId: string;
  facilityName: string;
  accreditation: PhilHealthAccreditation | null;
}) {
  const { pending, submit } = useSubmit();
  const [f, setF] = React.useState({
    accreditationNumber: accreditation?.accreditationNumber ?? "",
    validFrom: accreditation?.validFrom ?? "",
    validUntil: accreditation?.validUntil ?? "",
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>PhilHealth accreditation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        <p className="text-meta text-muted-foreground">
          {facilityName}. Used when PhilHealth claims are prepared. Sending claims electronically (eClaims) is not connected yet.
        </p>
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                recordAccreditation({
                  facilityId,
                  accreditationNumber: f.accreditationNumber,
                  validFrom: f.validFrom || undefined,
                  validUntil: f.validUntil || undefined,
                  version: accreditation?.version,
                }),
              "Accreditation saved",
            );
          }}
        >
          <Label htmlFor="ph-accreditation" className="col-span-2">
            Accreditation number
          </Label>
          <Input
            id="ph-accreditation"
            className="col-span-2"
            value={f.accreditationNumber}
            maxLength={40}
            onChange={(e) => setF({ ...f, accreditationNumber: e.target.value })}
          />
          <Label htmlFor="ph-valid-from">Valid from</Label>
          <Label htmlFor="ph-valid-until">Valid until</Label>
          <Input id="ph-valid-from" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
          <Input id="ph-valid-until" type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
          <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
