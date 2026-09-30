import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarCheckIcon, ClockIcon, UserCheckIcon } from "lucide-react";
import { AgendaList, clinicalDate, MiniCalendar, StatCard, type AgendaEntry } from "@healthcare/ui/healthcare";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AppointmentItem, ClinicDashboard, Page, PractitionerDetail, PractitionerScheduleRow } from "@/lib/api/types";
import { todayIn, upcomingAppointments } from "@/lib/clinic-mapping";
import { labelOf, PROFESSIONS, WEEKDAYS } from "../../appointments/schedules/labels";

export const metadata = { title: "Doctor" };

const hhmm = (t: string) => t.slice(0, 5);
const time = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-PH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));

/** One practitioner: profile, today's figures (from the clinic dashboard), weekly schedule and today's appointments. */
export default async function DoctorPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  if (!facility) return <FacilityRequired action="Schedules are kept per facility." />;
  const today = todayIn(facility.timezone);
  const [practitioners, schedules, appointments, dashboard] = await Promise.all([
    api<PractitionerDetail[]>("/clinic/practitioners"),
    api<PractitionerScheduleRow[]>("/clinic/schedules"),
    api<Page<AppointmentItem>>("/appointments", { query: { facilityId: facility.id, date: today, practitionerId: id, pageSize: 100 } }),
    can(session, "clinic.dashboard.read") ? api<ClinicDashboard>("/clinic/dashboard") : Promise.resolve(null),
  ]);
  const p = practitioners.find((x) => x.id === id);
  if (!p) notFound();
  const rows = schedules.filter(
    (s) => s.practitionerId === id && s.facilityId === facility.id && s.status === "active" && (!s.validUntil || s.validUntil >= today),
  );
  const work = dashboard?.providerWorkload.find((w) => w.practitionerId === id);
  const initials = p.displayName
    .replace(/^dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const d = new Date(`${today}T00:00:00Z`);
  const agenda: AgendaEntry[] = upcomingAppointments(appointments.items)
    .slice(0, 6)
    .map((a) => ({
      id: a.id,
      tag: "Appointment",
      title: a.patient?.displayName ?? "Patient",
      time: `${time(a.startsAt, facility.timezone)} – ${time(a.endsAt, facility.timezone)}`,
      day: String(d.getUTCDate()),
      weekday: new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "UTC" }).format(d),
      href: a.patient ? `/patients/${a.patientId}` : undefined,
    }));

  return (
    <>
      <PageHeader
        title={p.displayName}
        description={`${labelOf(PROFESSIONS, p.profession)}${p.specialty ? ` · ${p.specialty}` : ""} · ${facility.name}`}
        actions={
          <Link className="text-table text-primary hover:underline" href="/doctors">
            All doctors
          </Link>
        }
      />
      <div className="grid items-start gap-4 p-4 xl:grid-cols-[18rem_minmax(0,1fr)_19rem]">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <Avatar className="size-28 text-page-lg">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <h2 className="text-section-lg font-semibold">{p.displayName}</h2>
            <dl className="grid w-full grid-cols-3 gap-2 text-meta">
              <div>
                <dt className="text-muted-foreground">Profession</dt>
                <dd className="font-medium">{labelOf(PROFESSIONS, p.profession)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Specialty</dt>
                <dd className="font-medium">{p.specialty ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Active" : "Inactive"}</Badge>
                </dd>
              </div>
            </dl>
            <dl className="w-full rounded-lg bg-muted/60 p-3 text-left text-table">
              <dt className="text-meta text-muted-foreground">Licence number</dt>
              <dd className="font-medium">{p.licenseNumber ?? "Not recorded"}</dd>
              {p.licenseValidUntil ? (
                <>
                  <dt className="mt-2 text-meta text-muted-foreground">{p.licenseValidUntil < today ? "Expired" : "Valid until"}</dt>
                  <dd className="font-medium">{clinicalDate(`${p.licenseValidUntil}T12:00:00Z`)}</dd>
                </>
              ) : null}
              <dt className="mt-2 text-meta text-muted-foreground">Staff account</dt>
              <dd className="font-medium">{p.userId ? "Yes" : "None: cannot document or prescribe"}</dd>
            </dl>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {work ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Booked today" value={work.booked} icon={CalendarCheckIcon} footer="Appointments at this facility" />
              <StatCard label="Seen today" value={work.seen} icon={UserCheckIcon} footer="Consultations completed" />
              <StatCard
                label="Waiting"
                value={work.waiting}
                icon={ClockIcon}
                tone={work.waiting ? "warning" : "default"}
                footer="In the queue for this doctor"
              />
            </div>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Weekly schedule</CardTitle>
            </CardHeader>
            <CardContent className="py-0">
              {rows.length === 0 ? (
                <p className="py-3 text-table text-muted-foreground">No schedule at {facility.name}.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Slots</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...rows]
                      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
                      .map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{WEEKDAYS[s.dayOfWeek]}</TableCell>
                          <TableCell className="tabular">
                            {hhmm(s.startTime)}–{hhmm(s.endTime)}
                          </TableCell>
                          <TableCell>{s.slotMinutes} minutes</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-4" aria-label="Today">
          <MiniCalendar today={today} />
          <AgendaList title="Today's appointments" entries={agenda} empty="No more appointments today." />
        </aside>
      </div>
    </>
  );
}
