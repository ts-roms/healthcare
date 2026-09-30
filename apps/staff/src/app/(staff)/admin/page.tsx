import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { getSession } from "@/lib/api/session";
import { navigationForPermissions } from "@/lib/navigation";

export const metadata = { title: "Administration" };

const DESCRIPTIONS: Record<string, string> = {
  "/admin/organization": "Your organization's name and identifier.",
  "/admin/users": "Who can sign in, their roles and where each applies; suspend and reactivate.",
  "/admin/roles": "What each role allows; your organization's own roles.",
  "/admin/facilities": "Clinics, laboratories and other sites, and their departments.",
  "/admin/audit": "Who did what, when and to which record.",
  "/admin/integrations": "Outbound exchanges that failed or stalled.",
  "/admin/compliance": "Your organization's own compliance configuration and who validated it.",
  "/admin/consent-wording": "The wording patients agree to when they give consent online.",
};

/** The administration pages open to the signed-in user (the same list as the menu). */
export default async function AdministrationPage() {
  const session = await getSession();
  const admin = navigationForPermissions(session.permissions).find((item) => item.href === "/admin");
  if (!admin?.children?.length) redirect("/");
  return (
    <>
      <PageHeader title="Administration" />
      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
        {admin.children.map((child) => (
          <Card key={child.href}>
            <CardHeader>
              <CardTitle>
                <Link className="text-primary hover:underline" href={child.href}>
                  {child.label}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-table text-muted-foreground">{DESCRIPTIONS[child.href] ?? null}</CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
