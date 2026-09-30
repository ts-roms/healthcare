import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { Organization } from "@/lib/api/types";
import { OrganizationForm } from "./organization-form";

export const metadata = { title: "Company settings" };

/** The organization's own details. Anyone with `organization.read` sees them; `organization.manage` changes them. */
export default async function CompanySettingsPage() {
  const session = await getSession();
  if (!can(session, "organization.read")) redirect("/");
  const organization = await api<Organization>("/organization");
  const manage = can(session, "organization.manage");
  return (
    <>
      <PageHeader title="Company settings" description="Your organization's details, shown across the platform." />
      <div className="p-4">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent>
            {manage ? (
              <OrganizationForm organization={organization} />
            ) : (
              <dl className="grid gap-2 text-table">
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{organization.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Identifier</dt>
                  <dd>
                    <code>{organization.code}</code>
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
