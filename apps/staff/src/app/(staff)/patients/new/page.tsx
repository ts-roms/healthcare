import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { COOKIES } from "@/lib/api/config";
import { can, getFacilities, getSession } from "@/lib/api/session";
import { RegistrationFormView } from "./registration-form";

export const metadata = { title: "Register patient" };

export default async function RegisterPatientPage() {
  const [session, facilities, jar] = await Promise.all([getSession(), getFacilities(), cookies()]);
  if (!can(session, "patient.register")) redirect("/patients");
  const facility = facilities.find((f) => f.id === jar.get(COOKIES.facility)?.value);
  return (
    <>
      <PageHeader
        title="Register patient"
        description={facility ? `Registering at ${facility.name}. The system checks for existing records before creating a new one.` : undefined}
      />
      {facility ? (
        <RegistrationFormView />
      ) : (
        <p role="alert" className="m-4 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-warning-foreground">
          Select your facility in the top bar first. Patients are registered at a facility.
        </p>
      )}
    </>
  );
}
