import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApiError } from "@healthcare/web-session";
import { Button } from "@healthcare/ui/primitives";
import { api } from "@/lib/api/client";
import { getVisitTypes } from "@/lib/api/clinic";
import { can, getSession } from "@/lib/api/session";
import type { KioskRegistrationDetail } from "@/lib/api/types";
import { RegistrationReview } from "./registration-review";

export const metadata = { title: "Review registration" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One kiosk registration: what the person typed, who the Patient Master thinks they might be, and the decision. Opening it is audited. */
export default async function KioskRegistrationPage({ params }: { params: Promise<{ registrationId: string }> }) {
  const [{ registrationId }, session] = await Promise.all([params, getSession()]);
  if (!UUID.test(registrationId)) notFound();
  if (!can(session, "kiosk.registration.review")) redirect("/");

  let detail: KioskRegistrationDetail;
  try {
    detail = await api<KioskRegistrationDetail>(`/kiosk/admin/registrations/${registrationId}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === "registration_decided")) {
      return (
        <ModulePage title="Registration" description="This registration was already decided or has expired, so it can no longer be opened.">
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href="/queue/registrations">Back to registrations</Link>
          </Button>
        </ModulePage>
      );
    }
    throw error;
  }

  // Queueing the new patient needs the right to manage the queue; the choice is hidden without it.
  const canQueue = can(session, "clinic.queue.manage");
  const visitTypes = canQueue ? (await getVisitTypes()).filter((v) => v.modality === "in_person") : [];
  return (
    <ModulePage
      title={`Registration ${detail.reference}`}
      description="Check the details against the person's identification before you decide. The typed details are erased once you decide."
    >
      <RegistrationReview
        detail={detail}
        visitTypes={visitTypes.map((v) => ({ id: v.id, name: v.name }))}
        canApprove={can(session, "patient.register")}
        canLink={can(session, "patient.read")}
        canOpenRecord={can(session, "patient.read")}
      />
    </ModulePage>
  );
}
