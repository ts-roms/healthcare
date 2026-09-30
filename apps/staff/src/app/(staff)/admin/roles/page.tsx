import { redirect } from "next/navigation";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { StaffRoleDefinition } from "@/lib/api/types";
import { NewRoleForm } from "./new-role-form";
import { permissionGroups } from "./permission-groups";

export const metadata = { title: "Roles" };

/** The roles staff can hold: the platform's built-in roles and the organization's own, each with its permissions. */
export default async function RolesPage() {
  const session = await getSession();
  if (!can(session, "user.read")) redirect("/");
  const [roles, permissions] = await Promise.all([api<StaffRoleDefinition[]>("/roles"), api<string[]>("/permissions")]);
  const held = session.user.isPlatformAdmin ? permissions : permissions.filter((p) => session.permissions.includes(p));
  return (
    <>
      <PageHeader title="Roles" description="What each role allows. Built-in roles cannot be changed; your organization can add its own." />
      <div className="flex flex-col gap-4 p-4">
        {can(session, "role.manage") ? <NewRoleForm groups={permissionGroups(permissions)} held={held} /> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardHeader>
                <CardTitle>{role.name}</CardTitle>
                <Badge variant={role.isSystem ? "neutral" : "teal"} className="ml-auto">
                  {role.isSystem ? "Built-in" : "Your organization"}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-table">
                <p className="text-meta text-muted-foreground">
                  <code>{role.key}</code>
                  {role.description ? ` — ${role.description}` : null}
                </p>
                <dl className="grid gap-1">
                  {permissionGroups(role.permissions).map((group) => (
                    <div key={group.area} className="grid grid-cols-[8rem_1fr] gap-2">
                      <dt className="text-muted-foreground">{group.area}</dt>
                      <dd className="break-words">{group.permissions.join(", ")}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
