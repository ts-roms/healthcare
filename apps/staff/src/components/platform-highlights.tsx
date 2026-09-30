import {
  ActivityIcon,
  CalendarCheckIcon,
  ClipboardListIcon,
  PillIcon,
  SmartphoneIcon,
  FlaskConicalIcon,
  LockKeyholeIcon,
  ReceiptTextIcon,
  SmileIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@healthcare/ui/lib/utils";

/**
 * What the platform does, described once for the signed-out pages: the sign-in side panel
 * shows the highlights, the landing page (`/welcome`) the full list.
 */
export const PLATFORM_MODULES: ReadonlyArray<{ icon: LucideIcon; title: string; description: string; highlight?: boolean }> = [
  { icon: CalendarCheckIcon, title: "Clinic and queue", description: "Appointments, walk-ins, triage and consultations in one flow.", highlight: true },
  { icon: FlaskConicalIcon, title: "Connected laboratory", description: "Orders, specimens, verified results and critical values.", highlight: true },
  { icon: SmileIcon, title: "Dental", description: "Odontogram history, treatment plans and procedures.", highlight: true },
  { icon: VideoIcon, title: "Telemedicine", description: "Online consultations with escalation to in-person care.", highlight: true },
  { icon: ReceiptTextIcon, title: "Billing and PhilHealth", description: "Charges, invoices, HMO coverage and claim preparation.", highlight: true },
  { icon: ClipboardListIcon, title: "Care plans and recall", description: "Goals, follow-ups and patients due for their next visit." },
  { icon: PillIcon, title: "Pharmacy and inventory", description: "Dispensing, stock by lot and expiry, purchase orders." },
  { icon: SmartphoneIcon, title: "MyHealth patient portal", description: "Booking, released results, prescriptions, bills and messages." },
];

export const PLATFORM_HIGHLIGHTS = PLATFORM_MODULES.filter((m) => m.highlight);

export function BrandMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-lg",
          inverted ? "bg-sidebar-accent-foreground text-sidebar" : "bg-primary text-primary-foreground",
        )}
      >
        <ActivityIcon className="size-5" aria-hidden />
      </span>
      <span className="text-section-lg font-semibold tracking-tight whitespace-nowrap">Healthcare Platform</span>
    </div>
  );
}

/** The dark "details" half of a split page: brand, one-line promise, highlights, privacy note. */
export function PlatformHighlightsPanel({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "surface-deep relative isolate flex flex-col justify-between gap-10 overflow-hidden bg-sidebar p-10 text-sidebar-foreground xl:p-14",
        className,
      )}
    >
      {/* Soft brand glow; decorative only. */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 -z-10 size-[28rem] rounded-full bg-primary/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 -z-10 size-[26rem] rounded-full bg-teal/25 blur-3xl" />

      <BrandMark inverted className="text-sidebar-accent-foreground" />

      <div className="flex max-w-lg flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight text-sidebar-accent-foreground xl:text-4xl">
            One patient. One record. One connected care journey.
          </h2>
          <p className="text-section text-sidebar-foreground">
            Clinic, laboratory, dental, telemedicine and billing working from the same longitudinal health record.
          </p>
        </div>

        <ul className="grid gap-4">
          {PLATFORM_HIGHLIGHTS.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-body font-medium text-sidebar-accent-foreground">{title}</p>
                <p className="text-table text-sidebar-muted">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="flex items-center gap-2 text-meta text-sidebar-muted">
        <LockKeyholeIcon className="size-3.5" aria-hidden />
        Access is role-based and every patient record view is audited.
      </p>
    </aside>
  );
}
