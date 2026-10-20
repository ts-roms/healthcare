import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarPlusIcon, TriangleAlertIcon } from "lucide-react";
import { Avatar, AvatarFallback, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { FacilityRequired } from "@/components/facility-required";
import { api } from "@/lib/api/client";
import { getVisitTypes } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AppointmentItem, Availability, Page, PractitionerDetail, PractitionerScheduleRow, ScheduleExceptionRow, StaffUser } from "@/lib/api/types";
import { shiftDate, todayIn, zonedLocalToIso } from "@/lib/clinic-mapping";
import {
  closedDaysIn,
  closureTouchesDay,
  dayBars,
  hoursLabel,
  monthOf,
  monthRange,
  nextWeekCapacity,
  nextWeekStart,
  barWindow,
  setupSteps,
  shiftMonth,
  slotLengthNote,
  upcomingByDay,
  weeklyHours,
} from "@/lib/doctor-profile";
import { labelOf, PROFESSIONS, WEEKDAYS } from "../../appointments/schedules/labels";
import { DoctorCalendar } from "./doctor-calendar";
import { EditProfileButton, EditStep, PractitionerEditor } from "./practitioner-editor";

export const metadata = { title: "Doctor" };

/** How far ahead the page looks: for the next open slot, the week ahead and the upcoming list. */
const LOOK_AHEAD_DAYS = 28;
/** Days checked for open slots, at most, before saying there is none soon. */
const AVAILABILITY_DAYS = 6;

const timeOf = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-PH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));

/** One practitioner: profile, what is left to set up, the figures that matter for booking, weekly hours, credentials, a month calendar and what is coming. */
export default async function DoctorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const [{ id }, { month: monthParam }, session, facility] = await Promise.all([params, searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  if (!facility) return <FacilityRequired action="Schedules are kept per facility." />;
  const tz = facility.timezone;
  const today = todayIn(tz);
  const month = monthOf(monthParam, today);
  const configure = can(session, "clinic.configure");
  const iso = (date: string) => zonedLocalToIso(`${date}T00:00`, tz);
  const horizon = shiftDate(today, LOOK_AHEAD_DAYS);
  const thisMonth = monthRange(today.slice(0, 7));
  const shown = monthRange(month);

  const [practitioners, schedules, visitTypes] = await Promise.all([
    api<PractitionerDetail[]>("/clinic/practitioners"),
    api<PractitionerScheduleRow[]>("/clinic/schedules"),
    getVisitTypes(),
  ]);
  const p = practitioners.find((x) => x.id === id);
  if (!p) notFound();
  const rows = schedules.filter(
    (s) => s.practitionerId === id && s.facilityId === facility.id && s.status === "active" && (!s.validUntil || s.validUntil >= today),
  );

  const [ahead, seen, aheadClosures, monthClosures, users] = await Promise.all([
    api<Page<AppointmentItem>>("/appointments", { query: { facilityId: facility.id, practitionerId: id, from: iso(today), to: iso(horizon), pageSize: 100 } }),
    api<Page<AppointmentItem>>("/appointments", {
      query: { facilityId: facility.id, practitionerId: id, status: "completed", from: iso(thisMonth.first), to: iso(thisMonth.next), pageSize: 100 },
    }),
    api<ScheduleExceptionRow[]>("/clinic/schedule-exceptions", { query: { facilityId: facility.id, from: iso(today), to: iso(horizon) } }),
    api<ScheduleExceptionRow[]>("/clinic/schedule-exceptions", { query: { facilityId: facility.id, from: iso(shown.first), to: iso(shown.next) } }),
    configure && can(session, "user.read") ? api<StaffUser[]>("/users") : Promise.resolve([] as StaffUser[]),
  ]);
  // The doctor's own leave and the facility's closures; other doctors' leave does not concern this page.
  const mine = (list: ScheduleExceptionRow[]) => list.filter((c) => c.practitionerId === id || c.practitionerId === null);
  const leave = (list: ScheduleExceptionRow[]) => list.filter((c) => c.practitionerId === id);

  // The next open slot: the first of the next clinic days (up to a few of them) that still has one.
  const now = new Date();
  const visitType = visitTypes.find((v) => v.modality === "in_person") ?? visitTypes[0];
  const clinicWeekdays = new Set(rows.map((r) => r.dayOfWeek));
  const candidates: string[] = [];
  for (let i = 0; i < LOOK_AHEAD_DAYS && candidates.length < AVAILABILITY_DAYS; i++) {
    const date = shiftDate(today, i);
    const closed = mine(aheadClosures).some((c) => closureTouchesDay(c, date, tz));
    if (clinicWeekdays.has(new Date(`${date}T00:00:00Z`).getUTCDay()) && !closed) candidates.push(date);
  }
  const availability = new Map<string, Availability | null>();
  if (visitType && rows.length > 0) {
    await Promise.all(
      candidates.map(async (date) => {
        availability.set(
          date,
          await api<Availability>("/appointments/availability", {
            query: { practitionerId: id, facilityId: facility.id, visitTypeId: visitType.id, date },
          }).catch(() => null),
        );
      }),
    );
  }
  const nextSlot = candidates
    .flatMap((date) => availability.get(date)?.slots ?? [])
    .map((s) => s.startsAt)
    .filter((startsAt) => Date.parse(startsAt) > now.getTime())
    .sort()[0];

  // Booked in the week ahead, against what the schedule offers that week.
  const weekStart = nextWeekStart(today);
  const weekFrom = Date.parse(iso(weekStart));
  const weekTo = Date.parse(iso(shiftDate(weekStart, 7)));
  const bookedNextWeek = ahead.items.filter(
    (a) => ["booked", "confirmed", "checked_in", "completed"].includes(a.status) && Date.parse(a.startsAt) >= weekFrom && Date.parse(a.startsAt) < weekTo,
  ).length;
  const capacity = nextWeekCapacity(rows, mine(aheadClosures), today, tz);
  const hours = weeklyHours(rows);
  const seenPatients = new Set(seen.items.map((a) => a.patientId)).size;

  const steps = setupSteps(p, rows.length > 0);
  const upcoming = upcomingByDay(ahead.items, tz, now).slice(0, 3);
  const firstDay = upcoming[0];
  const openThatDay = firstDay
    ? (availability.get(firstDay.date) ??
      (visitType
        ? await api<Availability>("/appointments/availability", {
            query: { practitionerId: id, facilityId: facility.id, visitTypeId: visitType.id, date: firstDay.date },
          }).catch(() => null)
        : null))
    : null;
  const visitTypeName = new Map(visitTypes.map((v) => [v.id, v.name]));
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const notInClinicToday = !clinicWeekdays.has(todayDow);
  const initials = p.displayName
    .replace(/^dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const userOptions = users.map((u) => ({ id: u.id, name: `${u.displayName} (${u.email})` }));
  const linkedUser = users.find((u) => u.id === p.userId);
  const bars = dayBars(rows);
  const window = barWindow(rows);
  const nextLabel = nextSlot
    ? `${new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(nextSlot))} · ${timeOf(nextSlot, tz)}`
    : null;

  return (
    <PractitionerEditor practitioner={p} users={userOptions}>
      <header className="border-b bg-card px-6 pt-4 pb-5">
        <nav aria-label="Breadcrumb" className="text-table text-muted-foreground">
          <Link href="/doctors" className="font-medium text-primary hover:underline">
            Doctors
          </Link>{" "}
          / <span>{p.displayName}</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Avatar className="size-16 text-section-lg">
            <AvatarFallback className="bg-secondary text-secondary-foreground">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-page font-semibold tracking-tight">{p.displayName}</h1>
              <Badge variant={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Active" : "Inactive"}</Badge>
            </div>
            <p className="text-body text-muted-foreground">{[labelOf(PROFESSIONS, p.profession), p.specialty, facility.name].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {configure ? <EditProfileButton /> : null}
            {can(session, "appointment.manage") && p.status === "active" ? (
              <Button asChild>
                <Link href={`/appointments/new?practitionerId=${id}`}>
                  <CalendarPlusIcon /> Book appointment
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 md:p-6">
        {steps.length > 0 ? (
          <section aria-label="Profile setup" className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3">
            <TriangleAlertIcon className="size-5 shrink-0 text-warning-foreground" aria-hidden />
            <p className="text-body font-semibold text-warning-foreground">
              {steps.length} {steps.length === 1 ? "step" : "steps"} left to finish this doctor&apos;s profile
            </p>
            {steps.map((step) => {
              const text = (
                <>
                  {step.label} <span className="font-normal text-muted-foreground">— {step.hint}</span>
                </>
              );
              if (step.key === "schedule") {
                return configure ? (
                  <Link
                    key={step.key}
                    href="/appointments/schedules"
                    className="rounded-md border bg-card px-3 py-1.5 text-table font-medium hover:border-primary/50"
                  >
                    {text}
                  </Link>
                ) : null;
              }
              return configure ? (
                <EditStep key={step.key} variant="chip">
                  {text}
                </EditStep>
              ) : (
                <span key={step.key} className="rounded-md border bg-card px-3 py-1.5 text-table font-medium">
                  {text}
                </span>
              );
            })}
          </section>
        ) : null}

        <section aria-label="Figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            label="Next available"
            value={nextLabel ?? "—"}
            sub={nextLabel ? undefined : rows.length === 0 ? "no schedule here" : `none in ${LOOK_AHEAD_DAYS} days`}
          />
          <Tile label="Hours per week" value={hoursLabel(hours.minutes)} sub={`${hours.clinicDays} clinic ${hours.clinicDays === 1 ? "day" : "days"}`} />
          <Tile label="Next week" value={String(bookedNextWeek)} sub={`of ${capacity} slots booked`} />
          <Tile
            label="Seen this month"
            value={seen.hasMore ? `${seenPatients}+` : String(seenPatients)}
            sub={seenPatients === 1 && !seen.hasMore ? "patient" : "patients"}
          />
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-section-lg">Weekly schedule</CardTitle>
                {configure ? (
                  <Button asChild variant="secondary" size="sm" className="ml-auto">
                    <Link href="/appointments/schedules">Edit hours</Link>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className="py-2 text-body text-muted-foreground">No schedule at {facility.name}.</p>
                ) : (
                  <>
                    <ul className="divide-y border-t">
                      {bars.map((bar) => (
                        <li key={bar.dayOfWeek} className="grid grid-cols-[6.5rem_minmax(5rem,1fr)_auto_4.5rem] items-center gap-3 py-2.5 text-body">
                          <span className={bar.hours ? "font-semibold" : "text-muted-foreground"}>{WEEKDAYS[bar.dayOfWeek]}</span>
                          {bar.hours ? (
                            <span className="relative h-2.5 rounded-full bg-muted" role="img" aria-label={`In clinic ${bar.hours}`}>
                              {bar.segments.map((s, i) => (
                                <span key={i} className="absolute inset-y-0 rounded-full bg-primary" style={{ left: `${s.left}%`, width: `${s.width}%` }} />
                              ))}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Not in clinic</span>
                          )}
                          <span className="tabular text-right font-mono text-table whitespace-nowrap">{bar.hours ?? ""}</span>
                          <span className="text-right text-table text-muted-foreground">{bar.hours ? `${bar.slots} slots` : "—"}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-meta text-muted-foreground">
                      Bar shows hours within {String(window.start / 60).padStart(2, "0")}:00–{String(window.end / 60).padStart(2, "0")}:00.{" "}
                      {slotLengthNote(rows)}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-section-lg">Credentials</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-meta text-muted-foreground">PRC licence</dt>
                    <dd className="mt-0.5 text-body font-medium">
                      {p.licenseNumber ? (
                        <>
                          {p.licenseNumber}
                          {p.licenseValidUntil ? (
                            <span className="block text-table font-normal text-muted-foreground">
                              {p.licenseValidUntil < today ? "Expired" : "Valid until"} {clinicalDate(`${p.licenseValidUntil}T12:00:00Z`)}
                            </span>
                          ) : null}
                        </>
                      ) : configure ? (
                        <EditStep>+ Add licence number</EditStep>
                      ) : (
                        <span className="text-muted-foreground">Not recorded</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta text-muted-foreground">Staff account</dt>
                    <dd className="mt-0.5 text-body font-medium">
                      {p.userId ? (
                        (linkedUser?.displayName ?? "Linked")
                      ) : configure ? (
                        <EditStep>+ Link account</EditStep>
                      ) : (
                        <span className="text-muted-foreground">None: cannot document or prescribe</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>

          <aside className="flex flex-col gap-4" aria-label="Calendar and appointments">
            <DoctorCalendar
              month={month}
              today={today}
              clinicWeekdays={clinicWeekdays}
              leaveDays={closedDaysIn(month, leave(monthClosures), tz)}
              closedDays={closedDaysIn(
                month,
                monthClosures.filter((c) => c.practitionerId === null),
                tz,
              )}
              nextAvailable={nextSlot ? todayIn(tz, new Date(nextSlot)) : null}
              previousHref={`/doctors/${id}?month=${shiftMonth(month, -1)}`}
              nextHref={`/doctors/${id}?month=${shiftMonth(month, 1)}`}
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-section-lg">Upcoming appointments</CardTitle>
                <Link href={`/appointments?practitionerId=${id}`} className="ml-auto text-table font-medium text-primary underline underline-offset-2">
                  See all
                </Link>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {notInClinicToday ? (
                  <p className="rounded-md bg-muted px-3 py-2 text-table text-muted-foreground">Not in clinic today ({WEEKDAYS[todayDow]}).</p>
                ) : null}
                {upcoming.length === 0 ? (
                  <p className="text-table text-muted-foreground">No upcoming appointments in the next {LOOK_AHEAD_DAYS} days.</p>
                ) : null}
                {upcoming.map((day) => (
                  <section key={day.date} aria-label={day.label}>
                    <h3 className="text-meta font-semibold tracking-wide text-foreground">{day.label}</h3>
                    <ul className="divide-y border-t">
                      {day.items.slice(0, 4).map((a) => (
                        <li key={a.id} className="flex items-start gap-3 py-3">
                          <span className="tabular w-11 shrink-0 font-mono text-table text-primary">{timeOf(a.startsAt, tz)}</span>
                          <span className="min-w-0">
                            {a.patient ? (
                              <Link href={`/patients/${a.patientId}`} className="block truncate text-body font-semibold hover:underline">
                                {a.patient.displayName}
                              </Link>
                            ) : (
                              <span className="block text-body font-semibold">Patient</span>
                            )}
                            <span className="block truncate text-table text-muted-foreground">
                              {a.reason ?? visitTypeName.get(a.visitTypeId) ?? "Appointment"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {openThatDay && firstDay ? (
                  <p className="text-table text-muted-foreground">
                    {openThatDay.slots.length} open {openThatDay.slots.length === 1 ? "slot" : "slots"} left that day
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </PractitionerEditor>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-5 py-4">
      <p className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="tabular text-2xl font-semibold">{value}</span>
        {sub ? <span className="text-table text-muted-foreground">{sub}</span> : null}
      </p>
    </div>
  );
}
