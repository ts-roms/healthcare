import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { FacilityBookingRules, VisitType } from "@/lib/api/types";
import { BookingRules } from "./booking-rules";
import { VisitTypeList } from "./visit-type-list";

export const metadata = { title: "Visit types" };

export default async function VisitTypesPage() {
  const session = await getSession();
  if (!can(session, "appointment.read")) redirect("/");
  const [visitTypes, bookingRules] = await Promise.all([api<VisitType[]>("/clinic/visit-types"), api<FacilityBookingRules[]>("/clinic/booking-rules")]);
  return (
    <>
      <PageHeader
        title="Visit types"
        description="Choose which visits patients may book themselves in MyHealth, and each clinic's booking rules. Patients book only inside published schedules. Until a clinic sets its own rules: at least 2 hours ahead, up to 60 days out, at most 3 open bookings, and changes or cancellations until 2 hours before."
      />
      <VisitTypeList visitTypes={visitTypes} canConfigure={can(session, "clinic.configure")} />
      <BookingRules facilities={bookingRules} canConfigure={can(session, "clinic.configure")} />
    </>
  );
}
