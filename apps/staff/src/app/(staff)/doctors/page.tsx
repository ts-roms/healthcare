import Link from "next/link";
import { redirect } from "next/navigation";
import { PractitionerCard } from "@healthcare/ui/healthcare";
import { Button } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { PractitionerDetail, PractitionerScheduleRow } from "@/lib/api/types";
import { todayIn } from "@/lib/clinic-mapping";
import { labelOf, PROFESSIONS, WEEKDAYS } from "../appointments/schedules/labels";

export const metadata = { title: "Doctors" };

const hhmm = (t: string) => t.slice(0, 5);

/** The organization's practitioners as cards, filtered by profession; availability is "scheduled today" at the selected facility. */
export default async function DoctorsPage({ searchParams }: { searchParams: Promise<{ profession?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Doctors" />
        <FacilityRequired action="Who is scheduled is kept per facility." />
      </>
    );
  }
  const today = todayIn(facility.timezone);
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const [practitioners, schedules] = await Promise.all([
    api<PractitionerDetail[]>("/clinic/practitioners"),
    api<PractitionerScheduleRow[]>("/clinic/schedules"),
  ]);
  const here = schedules.filter((s) => s.facilityId === facility.id && s.status === "active" && (!s.validUntil || s.validUntil >= today));
  const active = practitioners.filter((p) => p.status === "active");
  const professions = PROFESSIONS.filter((pr) => active.some((p) => p.profession === pr.value));
  const shown = params.profession ? active.filter((p) => p.profession === params.profession) : active;

  return (
    <>
      <PageHeader
        title="Doctors"
        description={`${facility.name}: practitioners and who is scheduled today.`}
        actions={
          can(session, "clinic.configure") ? (
            <Button asChild size="sm">
              <Link href="/appointments/schedules">Manage practitioners</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <nav aria-label="Filter by profession" className="flex flex-wrap gap-1 border-b">
          {[{ value: "", label: "All" }, ...professions].map((pr) => {
            const on = (params.profession ?? "") === pr.value;
            return (
              <Link
                key={pr.value || "all"}
                href={pr.value ? `/doctors?profession=${pr.value}` : "/doctors"}
                aria-current={on ? "page" : undefined}
                className={`-mb-px border-b-2 px-4 py-2 text-table ${on ? "border-primary font-semibold text-primary-deep" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {pr.label}
              </Link>
            );
          })}
        </nav>
        {shown.length === 0 ? <p className="text-body text-muted-foreground">No practitioners to show.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((p) => {
            const rows = here.filter((s) => s.practitionerId === p.id);
            const hours = rows
              .slice(0, 3)
              .map((s) => `${WEEKDAYS[s.dayOfWeek]!.slice(0, 3)} ${hhmm(s.startTime)}–${hhmm(s.endTime)}`)
              .join(" · ");
            return (
              <PractitionerCard
                key={p.id}
                name={p.displayName}
                specialty={p.specialty ?? labelOf(PROFESSIONS, p.profession)}
                hours={rows.length === 0 ? "No schedule here" : `${hours}${rows.length > 3 ? ` · +${rows.length - 3} more` : ""}`}
                available={rows.some((s) => s.dayOfWeek === todayDow)}
                availableLabel="Scheduled today"
                unavailableLabel="Not scheduled today"
                actions={
                  <>
                    <Button asChild variant="secondary" size="sm" className="flex-1">
                      <Link href={`/doctors/${p.id}`}>View profile</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link href={`/appointments?practitionerId=${p.id}`}>Schedule</Link>
                    </Button>
                  </>
                }
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
