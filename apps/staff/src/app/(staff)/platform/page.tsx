import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2Icon, PlusIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { api } from "@/lib/api/client";
import { getSession } from "@/lib/api/session";
import type { TenantList } from "@/lib/api/types";
import { platformAccessProblem } from "./platform-access";
import { countLabel, TenantStatusBadge } from "./tenant-status";

export const metadata = { title: "Platform" };

/**
 * The platform console (docs/architecture/platform-console.md): every organization on the platform with its status and
 * operational figures, for platform administrators only. No patient's data is shown here; small patient counts are "<5".
 */
export default async function PlatformPage() {
  const session = await getSession();
  if (!session.user.isPlatformAdmin) redirect("/");
  let tenants: TenantList;
  try {
    tenants = await api<TenantList>("/platform/tenants");
  } catch (error) {
    return <ModulePage title="Platform">{platformAccessProblem(error)}</ModulePage>;
  }
  return (
    <ModulePage
      title="Platform"
      description="Every organization on the platform: status, facilities, staff and how many patients — never a patient's details."
      details={[
        "Only platform administrators with two-step verification see this page. Every view and change is recorded in the audit trail, and a view of one organization also in that organization's own trail.",
        "Suspending an organization ends every staff and MyHealth session at once; nobody of that organization can sign in until it is reactivated. Its scheduled outreach waits. Records stay as they are.",
        "Patient counts from 1 to 4 are shown as <5.",
      ]}
      actions={
        <Button asChild size="sm">
          <Link href="/platform/new">
            <PlusIcon aria-hidden /> New organization
          </Link>
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Organizations", tenants.totals.organizations],
            ["Active", tenants.totals.active],
            ["Suspended", tenants.totals.suspended],
          ] as const
        ).map(([label, value]) => (
          <Card key={label}>
            <CardContent className="py-4">
              <p className="text-meta text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="py-0">
        {tenants.items.length === 0 ? (
          <p className="flex items-center gap-2 p-4 text-body text-muted-foreground">
            <Building2Icon className="size-4" aria-hidden /> No organizations yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Facilities</TableHead>
                <TableHead className="text-right">Active staff</TableHead>
                <TableHead className="text-right">Patients</TableHead>
                <TableHead className="text-right">MyHealth accounts</TableHead>
                <TableHead>Last staff sign-in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/platform/${t.id}`} className="font-medium hover:underline">
                      {t.name}
                    </Link>
                    <span className="block font-mono text-meta text-muted-foreground">{t.code}</span>
                  </TableCell>
                  <TableCell>
                    <TenantStatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.facilities.active}
                    {t.facilities.total > t.facilities.active ? <span className="text-muted-foreground"> / {t.facilities.total}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{countLabel(t.activeStaff)}</TableCell>
                  <TableCell className="text-right tabular-nums">{countLabel(t.patients)}</TableCell>
                  <TableCell className="text-right tabular-nums">{countLabel(t.myHealthAccounts)}</TableCell>
                  <TableCell className="text-meta text-muted-foreground">{t.lastStaffSignInAt ? clinicalDateTime(t.lastStaffSignInAt) : "Never"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </ModulePage>
  );
}
