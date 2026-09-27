import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { QueueVisit } from "@/lib/api/types";
import { QueueWorkspace } from "./queue-workspace";

export const metadata = { title: "Queue" };

export default async function QueuePage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "clinic.queue.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Queue" />
        <FacilityRequired action="The queue belongs to a facility." />
      </>
    );
  }
  // Closed visits too, so the board shows who has already been seen today.
  const visits = await api<QueueVisit[]>("/queue", { query: { includeClosed: "true" } });
  const canManage = can(session, "clinic.queue.manage");
  return (
    <>
      <PageHeader
        title="Queue"
        description={`${facility.name} · today · refreshes automatically`}
        actions={
          canManage && can(session, "patient.search") ? (
            <Button asChild size="sm">
              <Link href="/patients">
                <SearchIcon /> Find patient to check in
              </Link>
            </Button>
          ) : null
        }
      />
      <QueueWorkspace visits={visits} canManage={canManage} canOpenRecord={can(session, "patient.read")} />
    </>
  );
}
