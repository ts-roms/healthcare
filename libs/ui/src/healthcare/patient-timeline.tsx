import * as React from "react";
import { FileTextIcon, FlaskConicalIcon, MonitorIcon, PillIcon, ReceiptIcon, SendIcon, SmileIcon, StethoscopeIcon, type LucideIcon } from "lucide-react";
import type { TimelineEvent, TimelineEventKind } from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { clinicalTime, relativeDay } from "../lib/format";
import { cn } from "../lib/utils";

const KIND: Record<TimelineEventKind, { icon: LucideIcon; tone: string; label: string }> = {
  encounter: { icon: StethoscopeIcon, tone: "bg-primary-subtle text-primary", label: "Encounter" },
  telemedicine: { icon: MonitorIcon, tone: "bg-primary-subtle text-primary", label: "Telemedicine" },
  lab: { icon: FlaskConicalIcon, tone: "bg-secondary text-secondary-foreground", label: "Laboratory" },
  prescription: { icon: PillIcon, tone: "bg-success-subtle text-success-foreground", label: "Prescription" },
  dental: { icon: SmileIcon, tone: "bg-info-subtle text-info-foreground", label: "Dental" },
  referral: { icon: SendIcon, tone: "bg-muted text-muted-foreground", label: "Referral" },
  billing: { icon: ReceiptIcon, tone: "bg-muted text-muted-foreground", label: "Billing" },
  document: { icon: FileTextIcon, tone: "bg-muted text-muted-foreground", label: "Document" },
};

/** Cross-module chronology — every service line in one stream. */
export function PatientTimeline({ events, filter, className }: { events: TimelineEvent[]; filter?: TimelineEventKind[]; className?: string }) {
  const shown = [...events].filter((e) => !filter?.length || filter.includes(e.kind)).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ol className={cn("relative flex flex-col", className)}>
      {shown.map((e, i) => {
        const k = KIND[e.kind];
        const Icon = k.icon;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < shown.length - 1 ? <span className="absolute top-7 bottom-0 left-[13px] w-px bg-border" aria-hidden /> : null}
            <span className={cn("z-[1] flex size-7 shrink-0 items-center justify-center rounded-full", k.tone)}>
              <Icon className="size-3.5" aria-label={k.label} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-body font-semibold">{e.title}</span>
                <time dateTime={e.date} className="tabular text-meta text-muted-foreground">
                  {relativeDay(e.date)} · {clinicalTime(e.date)}
                </time>
                {e.flag ? <Badge variant={e.flag === "critical" ? "critical" : "warning"}>{e.flag === "critical" ? "⚠ Critical" : "Abnormal"}</Badge> : null}
              </div>
              {e.detail ? <p className="text-table text-muted-foreground">{e.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
