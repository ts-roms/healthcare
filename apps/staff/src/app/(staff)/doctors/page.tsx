import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { clinicalDate, PractitionerCard, StatTile } from "@healthcare/ui/healthcare";
import { Button, Input } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { ClinicRoom, PractitionerDetail, PractitionerScheduleRow } from "@/lib/api/types";
import { shiftDate, todayIn } from "@/lib/clinic-mapping";
import { labelOf, PROFESSIONS } from "../appointments/schedules/labels";
import { SetSchedule } from "./set-schedule";

export const metadata = { title: "Doctors" };

const hhmm = (t: string) => t.slice(0, 5);

/** A licence is flagged from this many days before it ends. */
const LICENSE_WARNING_DAYS = 60;

/** The organization's practitioners as cards: figures, search, profession tabs; availability is "scheduled today" at the selected facility. */
export default async function DoctorsPage({ searchParams }: { searchParams: Promise<{ profession?: string; q?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  if (!facility) {
    return (
      <ModulePage title="Doctors">
        <FacilityRequired action="Who is scheduled is kept per facility." />
      </ModulePage>
    );
  }
  const today = todayIn(facility.timezone);
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const configure = can(session, "clinic.configure");
  const [practitioners, schedules, rooms] = await Promise.all([
    api<PractitionerDetail[]>("/clinic/practitioners"),
    api<PractitionerScheduleRow[]>("/clinic/schedules"),
    configure
      ? api<ClinicRoom[]>("/clinic/rooms", { query: { facilityId: facility.id } }).catch(() => [] as ClinicRoom[])
      : Promise.resolve([] as ClinicRoom[]),
  ]);
  const activeRooms = rooms.filter((r) => r.status === "active").map((r) => ({ id: r.id, name: r.name }));
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? null;
  const here = schedules.filter((s) => s.facilityId === facility.id && s.status === "active" && (!s.validUntil || s.validUntil >= today));
  const active = practitioners.filter((p) => p.status === "active");
  const rowsOf = (id: string) => here.filter((s) => s.practitionerId === id);
  const scheduledToday = active.filter((p) => rowsOf(p.id).some((s) => s.dayOfWeek === todayDow));
  const warnFrom = shiftDate(today, LICENSE_WARNING_DAYS);
  const licenseNote = (p: PractitionerDetail) => {
    if (!p.licenseValidUntil) return null;
    if (p.licenseValidUntil < today) return { label: `Licence expired ${clinicalDate(p.licenseValidUntil)}`, tone: "danger" as const };
    if (p.licenseValidUntil <= warnFrom) return { label: `Licence ends ${clinicalDate(p.licenseValidUntil)}`, tone: "warning" as const };
    return null;
  };
  const licenseIssues = active.filter((p) => licenseNote(p)).length;

  const q = (params.q ?? "").trim().toLowerCase();
  const matchesQuery = (p: PractitionerDetail) => !q || p.displayName.toLowerCase().includes(q) || (p.specialty ?? "").toLowerCase().includes(q);
  const searched = active.filter(matchesQuery);
  const professions = PROFESSIONS.filter((pr) => active.some((p) => p.profession === pr.value));
  const shown = params.profession ? searched.filter((p) => p.profession === params.profession) : searched;
  const tabHref = (profession: string) => {
    const query = new URLSearchParams();
    if (profession) query.set("profession", profession);
    if (params.q) query.set("q", params.q);
    const text = query.toString();
    return text ? `/doctors?${text}` : "/doctors";
  };

  return (
    <ModulePage
      title="Doctors"
      description={`${facility.name}: practitioners and who is scheduled today.`}
      actions={
        can(session, "clinic.configure") ? (
          <Button asChild size="sm">
            <Link href="/appointments/schedules">Manage practitioners</Link>
          </Button>
        ) : undefined
      }
    >
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active practitioners" value={active.length} />
        <StatTile label="Scheduled today" value={scheduledToday.length} hint={clinicalDate(today)} />
        <StatTile label="Not scheduled today" value={active.length - scheduledToday.length} />
        <StatTile
          label="Licences to renew"
          value={licenseIssues}
          tone={licenseIssues > 0 ? "alert" : "default"}
          hint={`Expired or ending within ${LICENSE_WARNING_DAYS} days`}
        />
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Filter by profession" className="flex flex-wrap gap-1.5">
          {[{ value: "", label: "All" }, ...professions].map((pr) => {
            const on = (params.profession ?? "") === pr.value;
            const count = pr.value ? searched.filter((p) => p.profession === pr.value).length : searched.length;
            return (
              <Link
                key={pr.value || "all"}
                href={tabHref(pr.value)}
                aria-current={on ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-table ${on ? "border-primary bg-primary-subtle font-semibold text-primary-deep" : "bg-card text-muted-foreground hover:text-foreground"}`}
              >
                {pr.label} <span className="tabular text-meta">{count}</span>
              </Link>
            );
          })}
        </nav>
        <form action="/doctors" role="search" className="flex w-full items-center gap-2 sm:w-72">
          {params.profession ? <input type="hidden" name="profession" value={params.profession} /> : null}
          <Input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Search name or specialty" aria-label="Search practitioners" />
          <Button type="submit" variant="outline" size="icon-sm" aria-label="Search">
            <SearchIcon />
          </Button>
        </form>
      </div>

      {shown.length === 0 ? <p className="text-body text-muted-foreground">No practitioners match.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {shown.map((p) => {
          const rows = rowsOf(p.id);
          const todays = rows.filter((s) => s.dayOfWeek === todayDow).sort((a, b) => a.startTime.localeCompare(b.startTime));
          const week = Array.from({ length: 7 }, (_, d) => rows.some((s) => s.dayOfWeek === d));
          return (
            <PractitionerCard
              key={p.id}
              name={p.displayName}
              specialty={p.specialty ?? labelOf(PROFESSIONS, p.profession)}
              hours={
                rows.length === 0
                  ? "No schedule here"
                  : todays.length > 0
                    ? `Today ${todays.map((s) => `${hhmm(s.startTime)}–${hhmm(s.endTime)}`).join(", ")}`
                    : "Not in today"
              }
              available={todays.length > 0}
              availableLabel="Scheduled today"
              unavailableLabel="Not scheduled today"
              week={week}
              today={todayDow}
              note={licenseNote(p)}
              actions={
                <>
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <Link href={`/doctors/${p.id}`}>View profile</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={`/appointments?practitionerId=${p.id}`}>Schedule</Link>
                  </Button>
                  {configure ? (
                    <SetSchedule
                      practitionerId={p.id}
                      practitionerName={p.displayName}
                      facilityId={facility.id}
                      today={today}
                      rooms={activeRooms}
                      rows={rows.map((s) => ({
                        id: s.id,
                        dayOfWeek: s.dayOfWeek,
                        startTime: s.startTime,
                        endTime: s.endTime,
                        slotMinutes: s.slotMinutes,
                        roomName: roomName(s.roomId),
                      }))}
                      className="w-full"
                    />
                  ) : null}
                </>
              }
            />
          );
        })}
      </div>
    </ModulePage>
  );
}
