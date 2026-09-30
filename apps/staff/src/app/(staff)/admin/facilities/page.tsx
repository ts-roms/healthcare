import { redirect } from "next/navigation";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { can, getSession } from "@/lib/api/session";
import { organizationDirectory } from "../users/directory";
import { facilityTypeLabel } from "./facility-types";
import { EditFacility, NewDepartment, NewFacility } from "./facility-forms";

export const metadata = { title: "Facilities" };

/** The organization's facilities (clinics, laboratories, dental clinics…) and the departments inside each. */
export default async function FacilitiesPage() {
  const session = await getSession();
  if (!can(session, "organization.read")) redirect("/");
  const { facilities, departments } = await organizationDirectory(session);
  const manage = can(session, "organization.manage");
  return (
    <>
      <PageHeader
        title="Facilities"
        description="Where your organization works. Roles can be granted for one facility or one of its departments."
        actions={manage ? <NewFacility /> : null}
      />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        {facilities.map((facility) => {
          const address = [facility.addressLine, facility.barangay, facility.cityMunicipality, facility.province, facility.postalCode]
            .filter(Boolean)
            .join(", ");
          const own = departments.filter((d) => d.facilityId === facility.id);
          return (
            <Card key={facility.id}>
              <CardHeader>
                <CardTitle>{facility.name}</CardTitle>
                <Badge variant={facility.status === "active" ? "success" : "warning"} className="ml-auto">
                  {facility.status === "active" ? "Active" : facility.status === "inactive" ? "Inactive" : facility.status}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-table">
                <p className="text-muted-foreground">
                  {facilityTypeLabel(facility.facilityType)} · <code>{facility.code}</code> · {facility.timezone}
                </p>
                {address ? <p>{address}</p> : null}
                {facility.contactNumber || facility.email ? <p>{[facility.contactNumber, facility.email].filter(Boolean).join(" · ")}</p> : null}
                {facility.licenseNumber ? <p>Licence number (as recorded): {facility.licenseNumber}</p> : null}
                <div>
                  <p className="font-medium">Departments</p>
                  {own.length === 0 ? (
                    <p className="text-muted-foreground">None</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1">
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
                {manage ? (
                  <div className="flex flex-wrap gap-2">
                    <EditFacility facility={facility} />
                    <NewDepartment facilityId={facility.id} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
