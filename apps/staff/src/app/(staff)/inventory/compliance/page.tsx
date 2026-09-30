import { redirect } from "next/navigation";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { ProcurementMethod, WithholdingCode } from "@/lib/api/types";
import { InventoryNav } from "../inventory-nav";
import { DeactivateButton, NewProcurementMethod, NewWithholdingCode } from "./compliance-forms";

export const metadata = { title: "Tax and procurement" };

/**
 * The organization's own withholding codes and procurement methods. The platform encodes no BIR or procurement rule:
 * codes, rates and methods come from the organization's accountant and procurement rules.
 */
export default async function InventoryCompliancePage() {
  const session = await getSession();
  if (!can(session, "inventory.read")) redirect("/");
  const canManage = can(session, "inventory.procurement.approve");
  const [codes, methods] = await Promise.all([
    api<WithholdingCode[]>("/inventory/withholding-codes"),
    api<ProcurementMethod[]>("/inventory/procurement-methods"),
  ]);
  const nav = (
    <InventoryNav
      canConfigure={can(session, "inventory.catalog.manage")}
      canValue={can(session, "inventory.valuation.read")}
      canRegister={can(session, "inventory.controlled-register.read")}
    />
  );
  return (
    <>
      <PageHeader
        title="Tax and procurement"
        description="Your organization's own withholding codes and procurement methods, as your accountant and procurement rules define them."
        actions={nav}
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="rounded-md border border-dashed p-3 text-meta text-muted-foreground">
          No BIR or public procurement rule is built in. The amount withheld is entered when a supplier invoice is paid; the rate here is only shown as a
          reminder. Have these settings checked by your accountant and record the review under Admin → Compliance.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Withholding codes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Rate (reference)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No withholding codes. Payments are recorded without withholding.
                    </TableCell>
                  </TableRow>
                ) : (
                  codes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.code}</TableCell>
                      <TableCell>{c.description}</TableCell>
                      <TableCell>{c.rateBasisPoints === null ? "—" : `${c.rateBasisPoints / 100}%`}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === "active" ? "success" : "neutral"}>{c.status === "active" ? "In use" : "Not in use"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && c.status === "active" ? <DeactivateButton kind="withholding-codes" id={c.id} label={c.code} /> : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {canManage ? <NewWithholdingCode /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Procurement methods</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-meta text-muted-foreground">Once any method is in use, every purchase order names one before it is submitted.</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Reference asked for</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {methods.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No procurement methods. Orders are submitted without one.
                    </TableCell>
                  </TableRow>
                ) : (
                  methods.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.code}</TableCell>
                      <TableCell>{m.name}</TableCell>
                      <TableCell>{m.referenceLabel ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={m.status === "active" ? "success" : "neutral"}>{m.status === "active" ? "In use" : "Not in use"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && m.status === "active" ? <DeactivateButton kind="procurement-methods" id={m.id} label={m.code} /> : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {canManage ? <NewProcurementMethod /> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
