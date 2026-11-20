import { ModulePage } from "@/components/module-page";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/api/session";
import { NewTenantForm } from "./new-tenant-form";

export const metadata = { title: "New organization" };

/** Creates a tenant: the organization, its first facility and its first administrator (platform administrators only). */
export default async function NewTenantPage() {
  const session = await getSession();
  if (!session.user.isPlatformAdmin) redirect("/");
  return (
    <ModulePage title="New organization" description="The organization, its first facility and the administrator who sets up the rest." width="medium">
      <NewTenantForm />
    </ModulePage>
  );
}
