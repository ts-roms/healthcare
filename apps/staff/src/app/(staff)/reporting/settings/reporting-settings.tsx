"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import type { DohFacilityCode, ReportableRule } from "@/lib/api/types";
import { createRule, deactivateRule, recordFacilityCode } from "../actions";

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

export function ReportingSettings({
  rules,
  facility,
}: {
  rules: ReportableRule[];
  facility: { id: string; name: string; code: DohFacilityCode | null } | null;
}) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
      <Rules rules={rules} />
      {facility ? <FacilityCode facility={facility} /> : null}
    </div>
  );
}

function Rules({ rules }: { rules: ReportableRule[] }) {
  const { pending, submit } = useSubmit();
  const empty = { codePrefix: "", category: "", sourceNote: "" };
  const [f, setF] = React.useState(empty);
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Rules</CardTitle>
        <p className="text-meta text-muted-foreground">
          An ICD-10 code or prefix (A9 covers A90–A99; A91 covers A91 and A91.x). Nothing is reportable until you add it here — take the list and categories
          from the official issuances your facility follows.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 pb-4">
        {rules.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.codePrefix}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell className="text-muted-foreground">{r.sourceNote ?? "—"}</TableCell>
                  <TableCell>{clinicalDate(r.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {r.status === "active" ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={pending}
                        onClick={() => submit(() => deactivateRule({ ruleId: r.id }), "Rule deactivated")}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Badge variant="neutral">Inactive</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-4 text-body text-muted-foreground">No reportable conditions configured.</p>
        )}
        <form
          className="grid gap-2 px-4 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end"
          aria-label="Add a reportable condition"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () => createRule({ ...f, sourceNote: f.sourceNote || undefined }),
              `${f.codePrefix.toUpperCase()} added`,
              () => setF(empty),
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-code">ICD-10 code</Label>
            <Input id="rule-code" value={f.codePrefix} maxLength={8} onChange={(e) => setF({ ...f, codePrefix: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-category">Category</Label>
            <Input id="rule-category" value={f.category} maxLength={120} onChange={(e) => setF({ ...f, category: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-source">Source (issuance)</Label>
            <Input id="rule-source" value={f.sourceNote} maxLength={500} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            <PlusIcon /> Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function FacilityCode({ facility }: { facility: { id: string; name: string; code: DohFacilityCode | null } }) {
  const { pending, submit } = useSubmit();
  const [code, setCode] = React.useState(facility.code?.facilityCode ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle>DOH health facility code</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        <p className="text-meta text-muted-foreground">{facility.name}. As issued by DOH; used on case reports. Not verified with DOH.</p>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => recordFacilityCode({ facilityId: facility.id, facilityCode: code, version: facility.code?.version }), "Facility code saved");
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="doh-facility-code">Facility code</Label>
            <Input id="doh-facility-code" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
