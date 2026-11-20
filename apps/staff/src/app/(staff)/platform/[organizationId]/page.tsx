import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, KeyRoundIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { api } from "@/lib/api/client";
import { getSession } from "@/lib/api/session";
import type { TenantDetail } from "@/lib/api/types";
import { facilityTypeLabel } from "../../admin/facilities/facility-types";
import { platformAccessProblem } from "../platform-access";
import { countLabel, TenantStatusBadge } from "../tenant-status";
import { TenantStatusControl } from "./status-control";

export const metadata = { title: "Organization" };

/** One organization in the platform console: figures, facilities, administrators and status history. No patient's data. */
export default async function TenantPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const session = await getSession();
  if (!session.user.isPlatformAdmin) redirect("/");
  const { organizationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) notFound();
  let tenant: TenantDetail;
  try {
    tenant = await api<TenantDetail>(`/platform/tenants/${organizationId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <ModulePage title="Organization">{platformAccessProblem(error)}</ModulePage>;
  }
  const figures: Array<[string, string]> = [
    ["Facilities", `${tenant.facilities.active} active${tenant.facilities.total > tenant.facilities.active ? ` of ${tenant.facilities.total}` : ""}`],
    ["Active staff", countLabel(tenant.activeStaff)],
    ["Patients", countLabel(tenant.patients)],
    ["MyHealth accounts", countLabel(tenant.myHealthAccounts)],
  ];
  return (
    <ModulePage
      title={tenant.name}
      description={`Code ${tenant.code} · created ${clinicalDateTime(tenant.createdAt)} · last staff sign-in ${tenant.lastStaffSignInAt ? clinicalDateTime(tenant.lastStaffSignInAt) : "never"}`}
      badges={<TenantStatusBadge status={tenant.status} />}
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href="/platform">
              <ArrowLeftIcon aria-hidden /> All organizations
            </Link>
          </Button>
          <TenantStatusControl
            organizationId={tenant.id}
            name={tenant.name}
            status={tenant.status}
            version={tenant.version}
            isCurrentOrganization={tenant.isCurrentOrganization}
          />
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        {figures.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="py-4">
              <p className="text-meta text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Administrators</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {tenant.administrators.length === 0 ? (
            <p className="px-6 text-body text-muted-foreground">Nobody holds the organization administrator role.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Two-step verification</TableHead>
                  <TableHead>Last sign-in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenant.administrators.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.displayName}</TableCell>
                    <TableCell>{a.email}</TableCell>
                    <TableCell>
                      {a.membershipStatus === "active" && a.accountStatus === "active" ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="neutral">{a.accountStatus !== "active" ? "Account disabled" : "Suspended here"}</Badge>
                      )}
                      {a.passwordChangeRequired ? (
                        <Badge variant="warning" className="ml-1">
                          <KeyRoundIcon aria-hidden /> Temporary password
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {a.mfaEnabled ? (
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheckIcon className="size-4 text-success-foreground" aria-hidden /> On
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <ShieldOffIcon className="size-4" aria-hidden /> Off
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-meta text-muted-foreground">{a.lastLoginAt ? clinicalDateTime(a.lastLoginAt) : "Never"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facilities</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Place</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenant.facilityList.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell className="font-mono text-meta">{f.code}</TableCell>
                  <TableCell>{facilityTypeLabel(f.facilityType)}</TableCell>
                  <TableCell>{[f.cityMunicipality, f.province].filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell>{f.status === "active" ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">{f.status}</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status history</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {tenant.statusHistory.length === 0 ? (
            <p className="px-6 text-body text-muted-foreground">Active since it was created.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenant.statusHistory.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-meta whitespace-nowrap">{clinicalDateTime(h.changedAt)}</TableCell>
                    <TableCell>
                      <TenantStatusBadge status={h.toStatus} />
                    </TableCell>
                    <TableCell className="max-w-md whitespace-pre-wrap">{h.reason}</TableCell>
                    <TableCell>{h.changedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ModulePage>
  );
}
