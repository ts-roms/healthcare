import { redirect } from "next/navigation";
import { CalendarClockIcon, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabLicenceOverview, LabLicenceState } from "@/lib/api/types";
import { LicenceForm } from "./licence-form";

export const metadata = { title: "Laboratory licence" };

const day = (d: string) => clinicalDate(`${d}T12:00:00Z`);

const STATE: Record<LabLicenceState, { label: string; variant: "success" | "warning" | "danger" | "neutral"; icon: typeof CircleCheckIcon }> = {
  valid: { label: "Valid", variant: "success", icon: CircleCheckIcon },
  expiring: { label: "Expiring soon", variant: "warning", icon: CalendarClockIcon },
  expired: { label: "Expired", variant: "danger", icon: CircleAlertIcon },
  not_yet_valid: { label: "Not yet valid", variant: "neutral", icon: CalendarClockIcon },
  missing: { label: "Not recorded", variant: "neutral", icon: CircleDashedIcon },
};

/** The facility's laboratory licence as recorded by staff; the platform checks its dates only (licensing rules are not encoded). */
export default async function LicencePage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Laboratory licence" />
        <FacilityRequired action="The licence is recorded per facility." />
      </>
    );
  }
  const overview = await api<LabLicenceOverview>("/laboratory/licence");
  const state = STATE[overview.state];
  const current = overview.current;
  return (
    <>
      <PageHeader title="Laboratory licence" description={`${facility.name} · the licence as issued, recorded by your laboratory`} />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current licence</CardTitle>
            <Badge variant={state.variant} className="ml-auto">
              <state.icon aria-hidden /> {state.label}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-table">
            {current ? (
              <>
                <p>
                  <span className="text-muted-foreground">Number: </span>
                  {current.licenceNumber}
                </p>
                {current.classification ? (
                  <p>
                    <span className="text-muted-foreground">Classification: </span>
                    {current.classification}
                  </p>
                ) : null}
                {current.issuedBy ? (
                  <p>
                    <span className="text-muted-foreground">Issued by: </span>
                    {current.issuedBy}
                  </p>
                ) : null}
                <p>
                  <span className="text-muted-foreground">Valid: </span>
                  {day(current.validFrom)} to {day(current.validUntil)} (reminder {current.reminderDays} days before)
                </p>
                {current.headName ? (
                  <p>
                    <span className="text-muted-foreground">Head of the laboratory: </span>
                    {current.headName}
                    {current.headLicenceNumber ? ` (${current.headLicenceNumber})` : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">No licence recorded for this facility.</p>
            )}
            <p className="mt-2 text-meta text-muted-foreground">
              The platform checks the dates only. It does not verify the licence with DOH or apply licensing rules; have them checked and record the review
              under Admin → Compliance.
            </p>
          </CardContent>
        </Card>
        {can(session, "lab.qc.manage") ? (
          <Card>
            <CardHeader>
              <CardTitle>{current ? "Record a renewal" : "Record the licence"}</CardTitle>
            </CardHeader>
            <CardContent>
              <LicenceForm />
            </CardContent>
          </Card>
        ) : null}
        {overview.history.length > 1 ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Earlier licences</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-table">
                {overview.history.slice(1).map((l) => (
                  <li key={l.id}>
                    {l.licenceNumber} · {day(l.validFrom)} to {day(l.validUntil)}{" "}
                    <span className="text-muted-foreground">· recorded {clinicalDateTime(l.recordedAt)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
