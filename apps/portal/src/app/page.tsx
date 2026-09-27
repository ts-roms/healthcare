import Link from "next/link";
import { CalendarPlusIcon, ChevronRightIcon, FlaskConicalIcon, PillIcon, VideoIcon, type LucideIcon } from "lucide-react";
import { appointments, mariaSantos } from "@healthcare/domain/fixtures";
import { AppointmentCard } from "@healthcare/ui/healthcare";
import { Badge, Button } from "@healthcare/ui/primitives";

const ACTIONS: { label: string; href: string; icon: LucideIcon; tone: string }[] = [
  { label: "Book appointment", href: "/appointments", icon: CalendarPlusIcon, tone: "bg-primary-subtle text-primary" },
  { label: "Online check-up", href: "/appointments?mode=online", icon: VideoIcon, tone: "bg-secondary text-secondary-foreground" },
  { label: "Lab results", href: "/results", icon: FlaskConicalIcon, tone: "bg-info-subtle text-info-foreground" },
  { label: "Prescriptions", href: "/prescriptions", icon: PillIcon, tone: "bg-success-subtle text-success-foreground" },
];

export default function HomePage() {
  const next = appointments.find((a) => a.patientId === mariaSantos.id) ?? appointments[0]!;
  const upcoming = { ...next, start: "2026-09-28T10:00:00+08:00", provider: "Dr. Elena Reyes", status: "booked" as const };
  return (
    <div className="flex flex-col gap-7">
      <section>
        <h1 className="text-page-lg font-semibold tracking-tight">
          Good morning, {mariaSantos.givenName}{" "}
          <span role="img" aria-label="waving hand">
            👋
          </span>
        </h1>
        <p className="text-muted-foreground">How can we help today?</p>
      </section>

      <nav aria-label="Quick actions" className="grid grid-cols-2 gap-3">
        {ACTIONS.map(({ label, href, icon: Icon, tone }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-28 flex-col justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className={`flex size-11 items-center justify-center rounded-xl ${tone}`}>
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="leading-tight font-semibold">{label}</span>
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Upcoming" href="/appointments" />
        <AppointmentCard
          variant="card"
          appointment={upcoming}
          action={
            <Button variant="outline" size="sm">
              Details
            </Button>
          }
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Recent results" href="/results" />
        <Link href="/results" className="flex items-center gap-4 rounded-xl border bg-card p-4 hover:bg-accent/50">
          <div className="flex-1">
            <p className="font-semibold">HbA1c (blood sugar, 3-month average)</p>
            <p className="tabular text-page-lg font-semibold">7.1%</p>
            <p className="text-body text-muted-foreground">Improved from 7.4% · Your doctor has reviewed this</p>
          </div>
          <Badge variant="success" className="text-body">
            Available
          </Badge>
          <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden />
        </Link>
      </section>
    </div>
  );
}

function SectionTitle({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-baseline justify-between border-b pb-1.5">
      <h2 className="text-section-lg font-semibold">{title}</h2>
      <Link href={href} className="text-body font-medium text-primary">
        See all
      </Link>
    </div>
  );
}
