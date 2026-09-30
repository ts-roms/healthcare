import Link from "next/link";
import {
  BanIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  ClipboardListIcon,
  ClockIcon,
  EyeOffIcon,
  FileInputIcon,
  FileTextIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  type LucideIcon,
  MessageSquareIcon,
  PillIcon,
  ReceiptIcon,
  SendIcon,
  SmileIcon,
  StethoscopeIcon,
  TestTubeIcon,
  WalletIcon,
  XCircleIcon,
} from "lucide-react";
import { clinicalDate, clinicalTime, RecordTimeline, type RecordTimelineItem } from "@healthcare/ui/healthcare";
import type { PatientTimelineEntry, PatientTimelineKind } from "@/lib/api/types";
import { entryHref, entryStatus, groupByDay, KIND_LABELS, markerLabel, type StatusTone, withheldNote } from "@/lib/timeline-mapping";
import { filedUnderText } from "@/lib/patient-merge";

const KIND_ICONS: Record<PatientTimelineKind, LucideIcon> = {
  appointment: CalendarIcon,
  encounter: StethoscopeIcon,
  referral: SendIcon,
  vitals: HeartPulseIcon,
  prescription: PillIcon,
  lab_order: TestTubeIcon,
  lab_result_release: FlaskConicalIcon,
  dental: SmileIcon,
  care_plan: ClipboardListIcon,
  invoice: ReceiptIcon,
  payment: WalletIcon,
  communication: MessageSquareIcon,
  external_history: FileInputIcon,
  document: FileTextIcon,
};

const TONE_ICONS: Record<StatusTone, LucideIcon> = {
  done: CheckCircle2Icon,
  active: CircleDotIcon,
  waiting: ClockIcon,
  stopped: BanIcon,
  failed: XCircleIcon,
  neutral: CircleDotIcon,
};

/** API entries as the design system's timeline items: labels, facility times (libs/ui format helpers), links. */
export function toTimelineItems(
  entries: readonly PatientTimelineEntry[],
  patientId: string,
  timeZone: string,
): Array<RecordTimelineItem & { occurredAt: string }> {
  return entries.map((e) => {
    const status = entryStatus(e);
    return {
      id: e.id,
      occurredAt: e.occurredAt,
      icon: KIND_ICONS[e.kind],
      kindLabel: KIND_LABELS[e.kind],
      title: e.title,
      // Entries of a record merged into this patient say which number they were filed under (text, not colour).
      detail: [e.detail, filedUnderText(e.filedUnder)].filter(Boolean).join(" · ") || null,
      dateTime: e.occurredAt,
      time: clinicalTime(e.occurredAt),
      facility: e.facility?.name ?? null,
      status: status ? { label: status.label, variant: status.variant, icon: TONE_ICONS[status.tone] } : null,
      flag: e.flag,
      marker: markerLabel(e),
      href: entryHref(e, patientId, timeZone),
    };
  });
}

/** The entries grouped by day and drawn with the design system's RecordTimeline. */
export function PatientTimelineView({ entries, patientId, timeZone }: { entries: readonly PatientTimelineEntry[]; patientId: string; timeZone: string }) {
  return <RecordTimeline days={groupByDay(toTimelineItems(entries, patientId, timeZone), clinicalDate)} linkComponent={Link} />;
}

/** "Some records are not shown to you", when the API withheld kinds. */
export function WithheldNote({ withheld }: { withheld: readonly string[] }) {
  const note = withheldNote(withheld);
  if (!note) return null;
  return (
    <p className="flex items-center gap-1.5 text-table text-muted-foreground">
      <EyeOffIcon className="size-4 shrink-0" aria-hidden /> {note}
    </p>
  );
}
