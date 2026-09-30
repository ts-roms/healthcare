import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheckIcon, ShieldOffIcon, UserXIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { StaffUser } from "@/lib/api/types";
import { AddStaffMember } from "./add-staff-member";
import { organizationDirectory, scopeLabel } from "./directory";

export const metadata = { title: "Staff users" };

/** The organization's staff: who can sign in, with which roles and where. */
export default async function StaffUsersPage() {
  const session = await getSession();
  if (!can(session, "user.read")) redirect("/");
  const [users, directory] = await Promise.all([api<StaffUser[]>("/users"), organizationDirectory(session)]);
  return (
    <>
      <PageHeader
        title="Staff users"
        description="Who can sign in to the staff app, their roles and where each role applies."
        actions={can(session, "user.manage") ? <AddStaffMember /> : null}
      />
      <div className="p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Two-step verification</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Last sign-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Link className="font-medium text-primary hover:underline" href={`/admin/users/${user.id}`}>
                    {user.displayName}
                  </Link>
                  <span className="block text-meta text-muted-foreground">{user.email}</span>
                </TableCell>
                <TableCell>
                  {user.membershipStatus === "active" && user.accountStatus === "active" ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="warning">
                      <UserXIcon aria-hidden /> {user.membershipStatus === "active" ? "Account locked" : "Suspended"}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {user.mfaEnabled ? (
                    <Badge variant="success">
                      <ShieldCheckIcon aria-hidden /> On
                    </Badge>
                  ) : (
                    <Badge variant="neutral">
                      <ShieldOffIcon aria-hidden /> Off
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="max-w-96 whitespace-normal">
                  {user.roleAssignments.length === 0 ? (
                    <span className="text-muted-foreground">No role — cannot use the app</span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {user.roleAssignments.map((a) => (
                        <li key={a.id}>
                          {a.roleName} <span className="text-meta text-muted-foreground">({scopeLabel(directory, a.facilityId, a.departmentId)})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{user.lastLoginAt ? clinicalDateTime(user.lastLoginAt) : "Never"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
