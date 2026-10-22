import { StaffSettingsPage } from "@/components/settings-page";
import { redirect } from "next/navigation";
import {
  BadgeCheckIcon,
  Building2Icon,
  ClockIcon,
  FlaskConicalIcon,
  HospitalIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  ScanLineIcon,
  SmileIcon,
  StethoscopeIcon,
  VideoIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StatTile } from "@healthcare/ui/healthcare";
import { Badge } from "@healthcare/ui/primitives";
import { can, getSession } from "@/lib/api/session";
import { organizationDirectory } from "../users/directory";
import { facilityTypeLabel } from "./facility-types";
import { EditFacility, NewDepartment, NewFacility } from "./facility-forms";

export const metadata = { title: "Facilities" };

const TYPE_ICON: Record<string, LucideIcon> = {
  clinic: StethoscopeIcon,
  laboratory: FlaskConicalIcon,
  dental_clinic: SmileIcon,
  hospital: HospitalIcon,
  diagnostic_center: ScanLineIcon,
  telemedicine_hub: VideoIcon,
};

/** One line of facts on a facility card: an icon, then the text. */
function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

/** The organization's facilities (clinics, laboratories, dental clinics…) and the departments inside each. */
export default async function FacilitiesPage() {
  const session = await getSession();
  if (!can(session, "organization.read")) redirect("/");
  const { facilities, departments } = await organizationDirectory(session);
  const manage = can(session, "organization.manage");
  const activeCount = facilities.filter((f) => f.status === "active").length;
  return (
    <StaffSettingsPage
      group="Organization"
      title="Facilities"
      description="Where your organization works."
      details={["Roles can be granted for one facility or one of its departments."]}
      actions={manage ? <NewFacility /> : null}
    >
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Facilities" value={facilities.length} />
        <StatTile label="Active" value={activeCount} hint={facilities.length > activeCount ? `${facilities.length - activeCount} not active` : undefined} />
        <StatTile label="Departments" value={departments.length} className="col-span-2 lg:col-span-1" />
      </section>

      {facilities.length === 0 ? <p className="text-body text-muted-foreground">No facilities yet.</p> : null}
      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {facilities.map((facility) => {
          const address = [facility.addressLine, facility.barangay, facility.cityMunicipality, facility.province, facility.postalCode]
            .filter(Boolean)
            .join(", ");
          const own = departments.filter((d) => d.facilityId === facility.id);
          const TypeIcon = TYPE_ICON[facility.facilityType] ?? Building2Icon;
          return (
            <article
              key={facility.id}
              aria-label={facility.name}
              className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs"
            >
              <header className="flex items-start gap-3 border-b bg-primary-subtle/50 p-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-card text-primary-deep shadow-xs">
                  <TypeIcon className="size-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-section font-semibold">{facility.name}</h3>
                  <p className="text-table text-muted-foreground">
                    {facilityTypeLabel(facility.facilityType)} · <code>{facility.code}</code>
                  </p>
                </div>
                <Badge variant={facility.status === "active" ? "success" : "warning"} className="shrink-0">
                  {facility.status === "active" ? "Active" : facility.status === "inactive" ? "Inactive" : facility.status}
                </Badge>
              </header>
              <div className="flex flex-1 flex-col gap-4 p-4 text-table">
                <ul className="flex flex-col gap-1.5">
                  {address ? (
                    <Fact icon={MapPinIcon} label="Address">
                      {address}
                    </Fact>
                  ) : null}
                  {facility.contactNumber ? (
                    <Fact icon={PhoneIcon} label="Contact number">
                      {facility.contactNumber}
                    </Fact>
                  ) : null}
                  {facility.email ? (
                    <Fact icon={MailIcon} label="Email">
                      {facility.email}
                    </Fact>
                  ) : null}
                  {facility.licenseNumber ? (
                    <Fact icon={BadgeCheckIcon} label="Licence number (as recorded)">
                      {facility.licenseNumber}
                    </Fact>
                  ) : null}
                  <Fact icon={ClockIcon} label="Time zone">
                    {facility.timezone}
                  </Fact>
                </ul>
                <div>
                  <p className="mb-1.5 text-meta font-semibold tracking-wider text-muted-foreground uppercase">Departments · {own.length}</p>
                  {own.length === 0 ? (
                    <p className="text-muted-foreground">None</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {own.map((d) => (
                        <li key={d.id}>
                          <Badge variant="outline">
                            {d.name} <code className="text-muted-foreground">{d.code}</code>
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {manage ? (
                <footer className="flex flex-wrap gap-2 border-t bg-muted/30 px-4 py-3">
                  <EditFacility facility={facility} />
                  <NewDepartment facilityId={facility.id} />
                </footer>
              ) : null}
            </article>
          );
        })}
      </div>
    </StaffSettingsPage>
  );
}
