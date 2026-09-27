import * as React from "react";
import { ActivityIcon, PillIcon, ShieldAlertIcon } from "lucide-react";
import type { Patient } from "@healthcare/domain";
import { cn } from "../lib/utils";
import { AllergyList } from "./allergy-badge";
import { MedicationList } from "./medication-list";

export function ProblemList({ problems, className }: { problems: Patient["problems"]; className?: string }) {
  const active = problems.filter((p) => p.status === "active");
  if (!active.length) return <p className={cn("text-table text-muted-foreground", className)}>No active problems.</p>;
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {active.map((p) => (
        <li key={p.id} className="flex items-baseline gap-2 text-body">
          {p.code ? <span className="w-12 shrink-0 font-mono text-meta text-muted-foreground">{p.code}</span> : null}
          <span>{p.description}</span>
        </li>
      ))}
    </ul>
  );
}

/** Stacked section heading used in dense side columns. */
export function SummarySection({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <h3 className="flex items-center gap-1.5 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
        {Icon ? <Icon className="size-3.5" /> : null}
        {title}
        {action ? <span className="ml-auto tracking-normal normal-case">{action}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Allergies · Medications · Problems — the always-needed clinical context. */
export function ClinicalSummary({ patient, children, className }: { patient: Patient; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <SummarySection title="Allergies" icon={ShieldAlertIcon}>
        <AllergyList allergies={patient.allergies} />
      </SummarySection>
      <SummarySection title="Medications" icon={PillIcon}>
        <MedicationList medications={patient.medications} dense />
      </SummarySection>
      <SummarySection title="Problems" icon={ActivityIcon}>
        <ProblemList problems={patient.problems} />
      </SummarySection>
      {children}
    </div>
  );
}
