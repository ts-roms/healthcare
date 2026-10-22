import Link from "next/link";
import {
  CalendarIcon,
  CalendarPlusIcon,
  ClipboardListIcon,
  ChevronRightIcon,
  FileTextIcon,
  FlaskConicalIcon,
  MessageCirclePlusIcon,
  PillIcon,
  ReceiptIcon,
  SyringeIcon,
  NotebookTextIcon,
  type LucideIcon,
} from "lucide-react";
import { Callout } from "@healthcare/ui/primitives";
import { EmptyState } from "@/components/empty-state";
import { ResultMeaning } from "@/components/result-meaning";
import { VisitCard } from "@/components/visit-card";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalAppointments, PortalResult } from "@/lib/api/types";
import { greeting } from "@/lib/greeting";
import { latestPerTest, resultDate, resultValue } from "@/lib/records";

const QUICK: { label: string; href: string; icon: LucideIcon; tone: string }[] = [
  { label: "Book a visit", href: "/appointments/book", icon: CalendarPlusIcon, tone: "bg-primary-subtle text-primary" },
  { label: "Results", href: "/results", icon: FlaskConicalIcon, tone: "bg-info-subtle text-info-foreground" },
  { label: "Bills", href: "/billing", icon: ReceiptIcon, tone: "bg-warning-subtle text-warning-foreground" },
  { label: "Ask the clinic", href: "/messages/new", icon: MessageCirclePlusIcon, tone: "bg-secondary text-secondary-foreground" },
];

const RECORDS: { label: string; hint: string; href: string; icon: LucideIcon }[] = [
  { label: "Prescriptions", hint: "Medicines prescribed to you", href: "/prescriptions", icon: PillIcon },
  { label: "Care plan", hint: "Goals and follow-ups", href: "/care-plan", icon: ClipboardListIcon },
  { label: "Documents & certificates", hint: "Copies of your records", href: "/documents", icon: FileTextIcon },
  { label: "Immunizations", hint: "Vaccines you have had", href: "/immunizations", icon: SyringeIcon },
  { label: "Health history", hint: "Tell the clinic about past illnesses", href: "/health-history", icon: NotebookTextIcon },
];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const [me, { welcome }, appointments, results] = await Promise.all([
    getMe(),
    searchParams,
    portalApi<PortalAppointments>("/portal/appointments"),
    portalApi<PortalResult[]>("/portal/results"),
  ]);
  const recent = latestPerTest(results).slice(0, 3);
  // Home shows what is still going to happen; cancelled visits stay listed under Visits.
  const next = appointments.upcoming.filter((v) => v.status !== "cancelled" && v.status !== "no_show");
  return (
    <div className="flex flex-col gap-7">
      {welcome ? <Callout tone="success">Your account is ready. Next time, sign in with {me.account.email}.</Callout> : null}
      {!me.account.emailVerified ? (
        <Callout
          tone="warning"
          title="Confirm your email"
          actions={
            <Link href="/security" className="rounded-md border border-warning/50 bg-card px-3 py-1.5 text-body font-medium text-foreground">
              Confirm now
            </Link>
          }
        >
          We have not checked that {me.account.email} is yours. It takes a minute.
        </Callout>
      ) : null}
      <section>
        <h1 className="text-page-lg font-semibold tracking-tight">
          {greeting(me.timeZone)}, {me.patient.givenName}
        </h1>
        <p className="text-muted-foreground">{me.organization.name} · How can we help today?</p>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Your next visit" href="/appointments" />
        {next.length ? (
          next.slice(0, 2).map((v) => <VisitCard key={v.id} visit={v} upcoming />)
        ) : (
          <EmptyState icon={CalendarIcon} title="No upcoming visits">
            Book a visit online, or contact the clinic.
          </EmptyState>
        )}
      </section>

      <nav aria-label="Quick actions" className="grid grid-cols-4 gap-2">
        {QUICK.map(({ label, href, icon: Icon, tone }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-2 rounded-xl border bg-card px-1 py-3 text-center shadow-xs transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className={`flex size-11 items-center justify-center rounded-xl ${tone}`}>
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="text-body leading-tight font-semibold">{label}</span>
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Recent results" href="/results" />
        {recent.length ? (
          <ul className="flex flex-col gap-2">
            {recent.map(({ latest }) => (
              <li key={latest.testId}>
                <Link href={`/results/${latest.testId}`} className="flex flex-col gap-1 rounded-xl border bg-card p-3">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{latest.testName}</span>
                    <span className="text-meta text-muted-foreground">{resultDate(latest.collectedAt ?? latest.releasedAt, me.timeZone)}</span>
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

      <section aria-labelledby="my-records" className="flex flex-col gap-3">
        <h2 id="my-records" className="border-b pb-1.5 text-section-lg font-semibold">
          My records
        </h2>
        <ul className="overflow-hidden rounded-xl border bg-card">
          {RECORDS.map(({ label, hint, href, icon: Icon }) => (
            <li key={href} className="border-b last:border-b-0">
              <Link
                href={href}
                className="flex items-center gap-3 px-3 py-3 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{label}</span>
                  <span className="block truncate text-body text-muted-foreground">{hint}</span>
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
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
