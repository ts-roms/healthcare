import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  FileLockIcon,
  FingerprintIcon,
  GlobeIcon,
  HandshakeIcon,
  KeyRoundIcon,
  LandmarkIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { BrandMark, PLATFORM_MODULES } from "@/components/platform-highlights";

export const metadata = {
  title: "Welcome",
  description:
    "An integrated healthcare platform for Philippine clinics: clinic, laboratory, dental, telemedicine, billing and a patient portal on one record.",
};

/** Public page (see PUBLIC_PATHS in proxy.ts): static content only, never calls the API. */

const NAV = [
  { href: "#modules", label: "Modules" },
  { href: "#journey", label: "Care journey" },
  { href: "#philippines", label: "Philippines" },
  { href: "#security", label: "Security" },
];

const JOURNEY: ReadonlyArray<{ title: string; description: string }> = [
  { title: "Register", description: "One Patient Master with duplicate review at the front desk." },
  { title: "Book or walk in", description: "Online booking, reception scheduling and a live queue." },
  { title: "Consult", description: "Triage, SOAP notes, diagnoses and prescriptions in one workspace." },
  { title: "Order labs", description: "Specimens, results, verification and approval in the LIS." },
  { title: "Release", description: "Approved results reach the doctor and, when releasable, the patient." },
  { title: "Follow up", description: "Care plans and recall bring the patient back when due." },
];

/** Illustrative only — the hero card shows the shape of a journey, not a real patient. */
const HERO_STEPS: ReadonlyArray<{ label: string; state: "done" | "active" | "next" }> = [
  { label: "Checked in · triage recorded", state: "done" },
  { label: "Consultation signed", state: "done" },
  { label: "Laboratory results in verification", state: "active" },
  { label: "Follow-up visit due", state: "next" },
];

const STEP_STATE: Record<(typeof HERO_STEPS)[number]["state"], { icon: LucideIcon; text: string; className: string }> = {
  done: { icon: CheckCircle2Icon, text: "Done", className: "text-success" },
  active: { icon: ClockIcon, text: "In progress", className: "text-warning" },
  next: { icon: CircleDashedIcon, text: "Next", className: "text-sidebar-muted" },
};

const PHILIPPINES: ReadonlyArray<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: LandmarkIcon,
    title: "PhilHealth workflows",
    description: "Claim and YAKAP packages prepared with readiness checks; eligibility answers recorded as history.",
  },
  { icon: ScrollTextIcon, title: "DOH case reporting", description: "Diagnoses matching your configured reportable conditions open a case for review." },
  { icon: GlobeIcon, title: "FHIR R4 exchange", description: "Audited read access to the record and a review queue for imported history." },
  { icon: ClockIcon, title: "Local by default", description: "Peso amounts, Philippine mobile numbers and clinical times in Asia/Manila." },
];

const SECURITY: ReadonlyArray<{ icon: LucideIcon; title: string; description: string }> = [
  { icon: UsersIcon, title: "Role-based access", description: "Permissions by organization, facility and role; the server checks every request." },
  { icon: FingerprintIcon, title: "Multi-factor sign-in", description: "Authenticator codes and secure, httpOnly sessions." },
  { icon: ShieldCheckIcon, title: "Complete audit trail", description: "Who viewed or changed which record, when, and why where required." },
  { icon: FileLockIcon, title: "Private documents", description: "Reports and images in private storage, opened through short-lived signed links." },
  { icon: HandshakeIcon, title: "Consent first", description: "Patient consent and communication preferences govern portal access and outreach." },
  { icon: StethoscopeIcon, title: "Clinicians decide", description: "Decision support is labelled, explained and can be overridden with a reason." },
];

export default function WelcomePage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/welcome" aria-label="Healthcare Platform home">
            <BrandMark />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-6 md:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="text-body text-muted-foreground transition-colors hover:text-foreground">
                {item.label}
              </a>
            ))}
          </nav>
          <Button asChild>
            <Link href="/login">
              <KeyRoundIcon /> <span className="hidden sm:inline">Staff sign in</span>
              <span className="sm:hidden">Sign in</span>
            </Link>
          </Button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative isolate overflow-hidden bg-sidebar text-sidebar-foreground">
          <div aria-hidden className="pointer-events-none absolute -top-40 right-0 -z-10 size-[36rem] rounded-full bg-primary/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-32 -z-10 size-[30rem] rounded-full bg-teal/25 blur-3xl" />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:py-24">
            <div className="flex flex-col gap-6">
              <p className="w-fit rounded-full border border-sidebar-border bg-sidebar-accent px-3 py-1 text-meta font-medium text-sidebar-accent-foreground">
                Integrated healthcare management for Philippine clinics
              </p>
              <h1 className="text-4xl leading-tight font-semibold tracking-tight text-sidebar-accent-foreground sm:text-5xl">
                One patient. One record. One connected care journey.
              </h1>
              <p className="max-w-xl text-section-lg text-sidebar-foreground">
                Clinic, laboratory, dental, telemedicine, billing and a patient portal working from the same longitudinal health record — so nothing is re-typed
                and nothing is lost between departments.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/login">
                    Sign in to your workspace <ArrowRightIcon />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="ghost"
                  className="border border-sidebar-border text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <a href="#modules">Explore the platform</a>
                </Button>
              </div>
            </div>

            <div
              aria-label="Example of a connected care journey"
              role="img"
              className="rounded-xl border border-sidebar-border bg-sidebar-accent/70 p-5 shadow-2xl backdrop-blur"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="text-body font-semibold text-sidebar-accent-foreground">Care journey</p>
                <span className="rounded-full bg-sidebar px-2 py-0.5 text-meta text-sidebar-muted">Illustration</span>
              </div>
              <ol className="grid gap-3">
                {HERO_STEPS.map((step) => {
                  const state = STEP_STATE[step.state];
                  const Icon = state.icon;
                  return (
                    <li key={step.label} className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar/60 px-3 py-2.5">
                      <Icon className={`size-4 shrink-0 ${state.className}`} aria-hidden />
                      <span className="flex-1 text-table text-sidebar-accent-foreground">{step.label}</span>
                      <span className={`text-meta font-medium ${state.className}`}>{state.text}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-sidebar-border pt-4">
                {["Clinic", "Laboratory", "Portal"].map((label) => (
                  <div key={label} className="rounded-md bg-sidebar/60 px-2 py-2 text-center text-meta text-sidebar-muted">
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Modules */}
        <section id="modules" className="scroll-mt-16 border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <SectionHeading eyebrow="Modules" title="Everything a clinic runs on, on one record">
              Each department gets a workspace built for how it works — a Patient 360 for doctors, a throughput workbench for the laboratory, a fast desk for
              reception.
            </SectionHeading>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLATFORM_MODULES.map(({ icon: Icon, title, description }) => (
                <li key={title} className="rounded-lg border bg-card p-5 shadow-xs transition-shadow hover:shadow-md">
                  <span className="mb-4 flex size-10 items-center justify-center rounded-md bg-primary-subtle text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="text-section font-semibold">{title}</h3>
                  <p className="mt-1 text-body text-muted-foreground">{description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Journey */}
        <section id="journey" className="scroll-mt-16 border-b bg-muted/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <SectionHeading eyebrow="Care journey" title="From front desk to follow-up without re-typing">
              Every step writes to the same patient timeline, so the next person in the journey sees what happened before.
            </SectionHeading>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {JOURNEY.map((step, index) => (
                <li key={step.title} className="flex gap-4 rounded-lg border bg-card p-5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-body font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-section font-semibold">{step.title}</h3>
                    <p className="mt-1 text-body text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Philippines */}
        <section id="philippines" className="scroll-mt-16 border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <SectionHeading eyebrow="Built for the Philippines" title="Designed around local healthcare workflows">
              Government integrations are replaceable adapters, connected only once their official specifications are in place.
            </SectionHeading>
            <FeatureGrid items={PHILIPPINES} className="lg:grid-cols-4" />
            <p className="mt-6 text-meta text-muted-foreground">
              Regulatory compliance (Data Privacy Act, DOH, PhilHealth, BIR) is validated for each deployment against current official requirements.
            </p>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-16 border-b bg-muted/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <SectionHeading eyebrow="Security and privacy" title="Patient data protected by default">
              Healthcare records are never casually changed or deleted: history is kept, corrections are recorded, and sensitive actions are audited.
            </SectionHeading>
            <FeatureGrid items={SECURITY} className="lg:grid-cols-3" />
          </div>
        </section>

        {/* Call to action */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="relative isolate overflow-hidden rounded-2xl bg-sidebar px-6 py-12 text-center text-sidebar-foreground sm:px-12">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 -z-10 size-[28rem] -translate-x-1/2 rounded-full bg-primary/30 blur-3xl"
            />
            <h2 className="text-3xl font-semibold tracking-tight text-sidebar-accent-foreground">Ready to start your shift?</h2>
            <p className="mx-auto mt-3 max-w-xl text-section text-sidebar-foreground">
              Sign in with the account your organization administrator created for you. Patients use MyHealth, the patient portal.
            </p>
            <Button asChild size="lg" className="mt-6">
              <Link href="/login">
                Staff sign in <ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-meta text-muted-foreground sm:flex-row sm:px-6">
          <BrandMark className="scale-90 text-foreground" />
          <p>Integrated healthcare management platform. For authorized healthcare staff.</p>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-body font-semibold text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-3 text-section text-muted-foreground">{children}</p>
    </div>
  );
}

function FeatureGrid({ items, className }: { items: ReadonlyArray<{ icon: LucideIcon; title: string; description: string }>; className?: string }) {
  return (
    <ul className={`mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 ${className ?? ""}`}>
      {items.map(({ icon: Icon, title, description }) => (
        <li key={title} className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-section font-semibold">{title}</h3>
            <p className="mt-1 text-body text-muted-foreground">{description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
