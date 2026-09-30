import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { KeyRoundIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { MfaPolicy, StaffRoleDefinition, StaffUser } from "@/lib/api/types";
import { ApiError } from "@healthcare/web-session";
import { MfaExemptionControl, ResetMfaButton } from "../../security/security-controls";
import { organizationDirectory, scopeLabel } from "../directory";
import { GrantRoleForm, MembershipControl, RevokeRoleButton, TemporaryPasswordReset } from "./user-controls";

export const metadata = { title: "Staff user" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StaffUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!UUID.test(userId)) notFound();
  const session = await getSession();
  if (!can(session, "user.read")) redirect("/");
  let user: StaffUser;
  try {
    user = await api<StaffUser>(`/users/${userId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [roles, directory, mfaPolicy] = await Promise.all([
    api<StaffRoleDefinition[]>("/roles"),
    organizationDirectory(session),
    api<MfaPolicy>("/security/mfa-policy"),
  ]);
  const manage = can(session, "user.manage");
  const manageMfa = can(session, "user.mfa.manage");
  const exemption = mfaPolicy.exemptions.find((e) => e.userId === user.id) ?? null;
  const self = user.id === session.user.id;
  // Only roles whose every permission the administrator holds can be handed out (the API refuses the others).
  const grantable = roles.filter((r) => session.user.isPlatformAdmin || r.permissions.every((p) => session.permissions.includes(p)));
  return (
    <>
      <PageHeader
        title={user.displayName}
        description={user.email}
        actions={
          <Link className="text-table text-primary hover:underline" href="/admin/users">
            All staff users
          </Link>
        }
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-table">
            {user.roleAssignments.length === 0 ? (
              <p className="text-muted-foreground">No role yet: they can sign in but see nothing until they have one.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {user.roleAssignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 p-2">
                    <span className="font-medium">{a.roleName}</span>
                    <span className="text-muted-foreground">{scopeLabel(directory, a.facilityId, a.departmentId)}</span>
                    {manage ? <RevokeRoleButton userId={user.id} assignmentId={a.id} roleName={a.roleName} /> : null}
                  </li>
                ))}
              </ul>
            )}
            {manage ? (
              <GrantRoleForm
                userId={user.id}
                roles={grantable.map((r) => ({ id: r.id, name: r.name }))}
                facilities={directory.facilities.filter((f) => f.status === "active").map((f) => ({ id: f.id, name: f.name }))}
                departments={directory.departments.filter((d) => d.status === "active").map((d) => ({ id: d.id, facilityId: d.facilityId, name: d.name }))}
                withheld={roles.length - grantable.length}
              />
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p>
              Membership: {user.membershipStatus === "active" ? <Badge variant="success">Active</Badge> : <Badge variant="warning">Suspended</Badge>}
              {user.accountStatus !== "active" ? (
                <Badge variant="warning" className="ml-1">
                  Account {user.accountStatus}
                </Badge>
              ) : null}
            </p>
            <p>
              Two-step verification:{" "}
              {user.mfaEnabled ? (
                <Badge variant="success">
                  <ShieldCheckIcon aria-hidden /> On
                </Badge>
              ) : (
                <Badge variant="neutral">
                  <ShieldOffIcon aria-hidden /> Off
                </Badge>
              )}
            </p>
            {exemption ? (
              <p>
                <Badge variant="warning">
                  <ShieldOffIcon aria-hidden /> Exempt
                </Badge>{" "}
                {exemption.reason}
              </p>
            ) : mfaPolicy.required && !user.mfaEnabled ? (
              <p className="text-muted-foreground">Your organization requires it: they can only set it up until they do.</p>
            ) : null}
            {manageMfa && !self ? (
              <div className="flex flex-wrap gap-2">
                {user.mfaEnabled ? <ResetMfaButton userId={user.id} /> : null}
                <MfaExemptionControl userId={user.id} exempt={exemption !== null} />
              </div>
            ) : null}
            <p className="text-muted-foreground">Last sign-in: {user.lastLoginAt ? clinicalDateTime(user.lastLoginAt) : "never"}</p>
            {user.passwordChangeRequired ? (
              <p>
                <Badge variant="warning">
                  <KeyRoundIcon aria-hidden /> Temporary password — must choose their own at the next sign-in
                </Badge>
              </p>
            ) : null}
            {manage && !self ? <MembershipControl userId={user.id} status={user.membershipStatus === "active" ? "active" : "suspended"} /> : null}
            {manage && !self ? <TemporaryPasswordReset userId={user.id} /> : null}
            {self ? <p className="text-meta text-muted-foreground">You cannot suspend yourself. Change your own password under My account.</p> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
