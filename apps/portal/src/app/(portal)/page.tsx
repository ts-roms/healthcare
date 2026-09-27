import Link from "next/link";
import { CalendarIcon, CalendarPlusIcon, CheckCircle2Icon, ClipboardListIcon, FlaskConicalIcon, PillIcon, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ResultMeaning } from "@/components/result-meaning";
import { VisitCard } from "@/components/visit-card";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalAppointments, PortalResult } from "@/lib/api/types";
import { greeting } from "@/lib/greeting";
import { latestPerTest, resultDate, resultValue } from "@/lib/records";

const ACTIONS: { label: string; href: string; icon: LucideIcon; tone: string }[] = [
  { label: "Book appointment", href: "/appointments", icon: CalendarPlusIcon, tone: "bg-primary-subtle text-primary" },
  { label: "Care plan", href: "/care-plan", icon: ClipboardListIcon, tone: "bg-secondary text-secondary-foreground" },
  { label: "Lab results", href: "/results", icon: FlaskConicalIcon, tone: "bg-info-subtle text-info-foreground" },
  { label: "Prescriptions", href: "/prescriptions", icon: PillIcon, tone: "bg-success-subtle text-success-foreground" },
];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const [me, { welcome }, appointments, results] = await Promise.all([
    getMe(),
    searchParams,
    portalApi<PortalAppointments>("/portal/appointments"),
    portalApi<PortalResult[]>("/portal/results"),
  ]);
  const recent = latestPerTest(results).slice(0, 3);
  return (
    <div className="flex flex-col gap-7">
      {welcome ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-subtle p-4 text-body text-success-foreground">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
          Your account is ready. Next time, sign in with {me.account.email}.
        </p>
      ) : null}
      <section>
        <h1 className="text-page-lg font-semibold tracking-tight">
          {greeting()}, {me.patient.givenName}
        </h1>
        <p className="text-muted-foreground">{me.organization.name} · How can we help today?</p>
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
        {appointments.upcoming.length ? (
          appointments.upcoming.slice(0, 2).map((v) => <VisitCard key={v.id} visit={v} upcoming />)
        ) : (
          <EmptyState icon={CalendarIcon} title="No upcoming visits">
            To book or change a visit, contact the clinic.
          </EmptyState>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Recent results" href="/results" />
        {recent.length ? (
          <ul className="flex flex-col gap-2">
            {recent.map(({ latest }) => (
              <li key={latest.testId}>
                <Link href={`/results/${latest.testId}`} className="flex flex-col gap-1 rounded-xl border bg-card p-3">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{latest.testName}</span>
                    <span className="text-meta text-muted-foreground">{resultDate(latest.collectedAt ?? latest.releasedAt)}</span>
                  </span>
                  <span className="tabular">
                    {resultValue(latest)} {latest.unit ?? ""}
                  </span>
                  <ResultMeaning result={latest} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={FlaskConicalIcon} title="No results to show yet">
            Results appear here after the laboratory releases them to you.
          </EmptyState>
        )}
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
