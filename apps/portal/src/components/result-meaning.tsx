import { AlertOctagonIcon, ArrowUpDownIcon, CheckCircle2Icon, MinusCircleIcon } from "lucide-react";
import type { PortalResult } from "@/lib/api/types";
import { resultMeaning, type ResultTone } from "@/lib/records";

const TONE: Record<ResultTone, { icon: typeof CheckCircle2Icon; className: string }> = {
  normal: { icon: CheckCircle2Icon, className: "bg-success-subtle text-success-foreground" },
  attention: { icon: ArrowUpDownIcon, className: "bg-warning-subtle text-warning-foreground" },
  urgent: { icon: AlertOctagonIcon, className: "bg-danger-subtle text-danger-foreground" },
  neutral: { icon: MinusCircleIcon, className: "bg-muted text-muted-foreground" },
};

/** Where a value sits against the usual range: icon + words + colour, never colour alone. */
export function ResultMeaning({ result }: { result: Pick<PortalResult, "flag"> }) {
  const meaning = resultMeaning(result);
  const { icon: Icon, className } = TONE[meaning.tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-meta font-medium ${className}`}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {meaning.text}
    </span>
  );
}
