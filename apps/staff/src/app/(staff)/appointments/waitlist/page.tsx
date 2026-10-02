import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { getPractitioners, getVisitTypes } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { WaitlistEntry, WaitlistOffer } from "@/lib/api/types";
import { OffersTable } from "./offers-table";
import { WaitlistTable } from "./waitlist-table";

export const metadata = { title: "Waiting list" };

/** Patients waiting for a time at the selected facility, whether the patient asked in MyHealth or staff added them. */
export default async function WaitlistPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Waiting list" />
        <FacilityRequired action="The waiting list is kept per facility." />
      </>
    );
  }
  const [entries, offers, practitioners, visitTypes] = await Promise.all([
    api<WaitlistEntry[]>("/waitlist", { query: { facilityId: facility.id } }),
    api<WaitlistOffer[]>("/waitlist/offers", { query: { facilityId: facility.id, includeClosed: "true" } }),
    getPractitioners(),
    getVisitTypes(),
  ]);
  const offerRows = offers.slice(0, 50).map((o) => ({
    ...o,
    practitionerName: practitioners.find((p) => p.id === o.practitionerId)?.displayName ?? null,
    visitTypeName: visitTypes.find((v) => v.id === o.visitTypeId)?.name ?? null,
  }));
  const rows = entries.map((e) => ({
    ...e,
    practitionerName: practitioners.find((p) => p.id === e.practitionerId)?.displayName ?? null,
    visitTypeName: visitTypes.find((v) => v.id === e.visitTypeId)?.name ?? null,
    days:
      e.earliestDate === e.latestDate
        ? clinicalDate(`${e.earliestDate}T12:00:00Z`)
        : `${clinicalDate(`${e.earliestDate}T12:00:00Z`)} – ${clinicalDate(`${e.latestDate}T12:00:00Z`)}`,
  }));
  return (
    <>
      <PageHeader
        title={`Waiting list — ${facility.name}`}
        description="Patients waiting for a time, oldest and most urgent first. Patients who asked in MyHealth are texted or emailed when a matching time opens and book it themselves; nothing is booked for them. When you book one, close the entry with the reason."
        actions={
          <Link href="/appointments/visit-types" className="text-table text-primary hover:underline">
            Online booking rules
          </Link>
        }
      />
      <WaitlistTable rows={rows} canManage={can(session, "appointment.manage")} />
      <OffersTable rows={offerRows} canManage={can(session, "appointment.manage")} />
    </>
  );
}
