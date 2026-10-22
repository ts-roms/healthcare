import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { getSession } from "@/lib/api/session";
import { settingsForPermissions } from "@/lib/settings-navigation";

export const metadata = { title: "Settings" };

/** Settings home: every configuration page open to the signed-in user, grouped (the same list as the Settings menu). */
export default async function SettingsPage() {
  const session = await getSession();
  const groups = settingsForPermissions(session.permissions);
  if (groups.length === 0) redirect("/");
  return (
    <>
      <PageHeader title="Settings" description="Set up your organization, its facilities and each module." />
      <div className="flex flex-col gap-6 p-4">
        {groups.map((group) => (
          <section key={group.label} aria-labelledby={`settings-${group.label}`} className="flex flex-col gap-3">
            <h2 id={`settings-${group.label}`} className="text-section font-semibold">
              {group.label}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.pages.map((page) => (
                <Card key={page.href}>
                  <CardHeader>
                    <CardTitle>
                      <Link className="text-primary hover:underline" href={page.href}>
                        {page.label}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-table text-muted-foreground">{page.description}</CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
