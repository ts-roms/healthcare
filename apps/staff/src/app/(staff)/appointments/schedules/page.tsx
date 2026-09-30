import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDate, clinicalDateTime, PractitionerCard } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { ClinicRoom, PractitionerDetail, PractitionerScheduleRow, ScheduleExceptionRow, StaffUser } from "@/lib/api/types";
import { todayIn } from "@/lib/clinic-mapping";
import { labelOf, PROFESSIONS, ROOM_TYPES, WEEKDAYS } from "./labels";
import { AddClosure, AddPractitioner, AddRoom, AddSchedule, EditPractitioner, RetireSchedule } from "./schedule-forms";

export const metadata = { title: "Schedules" };

const day = (d: string) => clinicalDate(`${d}T12:00:00Z`);
const hhmm = (t: string) => t.slice(0, 5);

/**
 * Who works when at the selected facility: practitioners, rooms, weekly schedules (the open slots booking offers) and
 * closures. Changes need clinic.configure; everyone who reads appointments can see them.
 */
export default async function SchedulesPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Schedules" />
        <FacilityRequired action="Schedules, rooms and closures are kept per facility." />
      </>
    );
  }
  const configure = can(session, "clinic.configure");
  const today = todayIn(facility.timezone);
  const from = new Date();
  const until = new Date(from.getTime() + 90 * 24 * 3600_000);
  const [practitioners, rooms, schedules, closures, users] = await Promise.all([
    api<PractitionerDetail[]>("/clinic/practitioners"),
    api<ClinicRoom[]>("/clinic/rooms", { query: { facilityId: facility.id } }),
    api<PractitionerScheduleRow[]>("/clinic/schedules"),
    api<ScheduleExceptionRow[]>("/clinic/schedule-exceptions", { query: { facilityId: facility.id, from: from.toISOString(), to: until.toISOString() } }),
    configure && can(session, "user.read") ? api<StaffUser[]>("/users") : Promise.resolve([] as StaffUser[]),
  ]);
  const here = schedules.filter((s) => s.facilityId === facility.id && s.status === "active" && (!s.validUntil || s.validUntil >= today));
  const practitionerName = (id: string | null) => (id ? (practitioners.find((p) => p.id === id)?.displayName ?? "A practitioner") : null);
  const roomName = (id: string | null) => (id ? (rooms.find((r) => r.id === id)?.name ?? "A room") : null);
  const active = practitioners.filter((p) => p.status === "active");
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const byPractitioner = active
    .map((p) => ({ practitioner: p, rows: here.filter((s) => s.practitionerId === p.id) }))
    .filter((g) => g.rows.length > 0 || configure);

  return (
    <>
      <PageHeader
        title="Schedules"
        description={`${facility.name}: who works when, the rooms and the closures. Booking (by staff and in MyHealth) offers only slots inside these schedules.`}
        actions={
          <Link className="text-table text-primary hover:underline" href="/appointments">
            Appointments
          </Link>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        {active.length > 0 ? (
          <section aria-label="Practitioners at this facility" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {active.map((p) => {
              const rows = here.filter((s) => s.practitionerId === p.id);
              const worksToday = rows.some((s) => s.dayOfWeek === todayDow);
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
                  available={worksToday}
                  availableLabel="Scheduled today"
                  unavailableLabel="Not scheduled today"
                />
              );
            })}
          </section>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Weekly schedules</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-table">
            {configure ? (
              <AddSchedule
                facilityId={facility.id}
                today={today}
                practitioners={active.map((p) => ({ id: p.id, name: p.displayName }))}
                rooms={rooms.filter((r) => r.status === "active").map((r) => ({ id: r.id, name: r.name }))}
              />
            ) : null}
            {byPractitioner.length === 0 ? <p className="text-muted-foreground">No schedules at this facility yet.</p> : null}
            {byPractitioner.map(({ practitioner, rows }) => (
              <div key={practitioner.id}>
                <p className="font-medium">{practitioner.displayName}</p>
                {rows.length === 0 ? (
                  <p className="text-muted-foreground">No schedule here.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {rows.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 p-2">
                        <span className="w-24 font-medium">{WEEKDAYS[s.dayOfWeek]}</span>
                        <span>
                          {hhmm(s.startTime)}–{hhmm(s.endTime)} · {s.slotMinutes}-minute slots
                        </span>
                        {roomName(s.roomId) ? <span className="text-muted-foreground">{roomName(s.roomId)}</span> : null}
                        <span className="text-meta text-muted-foreground">
                          from {day(s.validFrom)}
                          {s.validUntil ? ` to ${day(s.validUntil)}` : ""}
                        </span>
                        {configure ? <RetireSchedule scheduleId={s.id} label={`${WEEKDAYS[s.dayOfWeek]} ${hhmm(s.startTime)}–${hhmm(s.endTime)}`} /> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Closures (next 90 days)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-table">
            <p className="text-muted-foreground">
              A closure removes slots from booking: the whole facility (e.g. a holiday your organization observes) or one practitioner (leave). Appointments
              already booked in that time are not moved — reschedule them from Appointments.
            </p>
            {configure ? (
              <AddClosure facilityId={facility.id} timeZone={facility.timezone} practitioners={active.map((p) => ({ id: p.id, name: p.displayName }))} />
            ) : null}
            {closures.length === 0 ? (
              <p className="text-muted-foreground">None.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {closures.map((c) => (
                  <li key={c.id} className="flex flex-wrap gap-2 p-2">
                    <span className="font-medium">{practitionerName(c.practitionerId) ?? "Whole facility"}</span>
                    <span>
                      {clinicalDateTime(c.startsAt)} – {clinicalDateTime(c.endsAt)}
                    </span>
                    <span className="text-muted-foreground">{c.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Practitioners</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-table">
              {configure ? <AddPractitioner users={users.map((u) => ({ id: u.id, name: `${u.displayName} (${u.email})` }))} /> : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Profession</TableHead>
                    <TableHead>Licence</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {practitioners.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-normal">
                        <span className="flex items-center gap-1">
                          {p.displayName}
                          {configure ? (
                            <EditPractitioner practitioner={p} users={users.map((u) => ({ id: u.id, name: `${u.displayName} (${u.email})` }))} />
                          ) : null}
                        </span>
                        <span className="block text-meta text-muted-foreground">
                          {p.userId ? "Has a staff account" : "No staff account: cannot document or prescribe"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {labelOf(PROFESSIONS, p.profession)}
                        {p.specialty ? <span className="block text-meta text-muted-foreground">{p.specialty}</span> : null}
                      </TableCell>
                      <TableCell>
                        {p.licenseNumber ?? <span className="text-muted-foreground">Not recorded</span>}
                        {p.licenseValidUntil ? (
                          <span className={p.licenseValidUntil < today ? "block text-meta text-danger" : "block text-meta text-muted-foreground"}>
                            {p.licenseValidUntil < today ? "Expired" : "Valid until"} {day(p.licenseValidUntil)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rooms at {facility.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-table">
              {configure ? <AddRoom facilityId={facility.id} /> : null}
              {rooms.length === 0 ? (
                <p className="text-muted-foreground">No rooms yet. Rooms are optional; two appointments in the same room cannot overlap.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {rooms.map((r) => (
                    <li key={r.id} className="flex flex-wrap gap-2 p-2">
                      <span className="font-medium">{r.name}</span>
                      <code className="text-muted-foreground">{r.code}</code>
                      <span className="text-muted-foreground">{labelOf(ROOM_TYPES, r.roomType)}</span>
                      {r.status !== "active" ? <Badge variant="neutral">Inactive</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
