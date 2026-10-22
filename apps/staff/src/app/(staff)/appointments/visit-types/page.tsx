import { StaffSettingsPage, SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { getPractitioners } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { FacilityBookingRules, VisitType, WaitlistRule } from "@/lib/api/types";
import { BookingRules } from "./booking-rules";
import { VisitTypeList } from "./visit-type-list";
import { WaitlistRules } from "./waitlist-rules";

export const metadata = { title: "Visit types" };

export default async function VisitTypesPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  const [visitTypes, bookingRules, waitlistRules, practitioners] = await Promise.all([
    api<VisitType[]>("/clinic/visit-types"),
    api<FacilityBookingRules[]>("/clinic/booking-rules"),
    facility ? api<WaitlistRule[]>("/clinic/waitlist-rules", { query: { facilityId: facility.id } }) : Promise.resolve([] as WaitlistRule[]),
    facility ? getPractitioners() : Promise.resolve([]),
  ]);
  return (
    <StaffSettingsPage
      group="Scheduling"
      title="Visit types"
      description="Choose which visits patients may book themselves in MyHealth, and each clinic's booking rules."
      details={[
        "Patients book only inside published schedules.",
        "Until a clinic sets its own rules: at least 2 hours ahead, up to 60 days out, at most 3 open bookings, and changes or cancellations until 2 hours before.",
      ]}
    >
      <SettingsStack>
        <VisitTypeList visitTypes={visitTypes} canConfigure={can(session, "clinic.configure")} />
        <BookingRules facilities={bookingRules} canConfigure={can(session, "clinic.configure")} />
        {facility ? (
          <WaitlistRules
            facilityId={facility.id}
            facilityName={facility.name}
            rules={waitlistRules}
            visitTypes={visitTypes.filter((v) => v.status === "active")}
            practitioners={practitioners}
            canConfigure={can(session, "clinic.configure")}
          />
        ) : (
          <p className="px-4 pb-4 text-table text-muted-foreground">
            Select a facility in the top bar to set waiting-list rules per visit type or practitioner.
          </p>
        )}
      </SettingsStack>
    </StaffSettingsPage>
  );
}
