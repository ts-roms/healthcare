import { SparklesIcon } from "lucide-react";
import { cn } from "@healthcare/ui/lib/utils";

const SIZES = {
  xs: { box: "size-6", icon: "size-3.5" },
  sm: { box: "size-7", icon: "size-4" },
  lg: { box: "size-12", icon: "size-6" },
} as const;

/**
 * The assistant's mark: sparkles on the brand gradient, or on a light veil over a primary button (`onPrimary`).
 * Decorative only (the text beside it names Ask); the assistant runs built-in rules, so nothing here says "AI".
 */
export function AssistantMark({ size = "sm", onPrimary = false, className }: { size?: keyof typeof SIZES; onPrimary?: boolean; className?: string }) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        onPrimary ? "bg-primary-foreground/15 text-primary-foreground" : "bg-linear-to-br from-teal to-info text-primary-foreground shadow-xs",
        s.box,
        className,
      )}
    >
      <SparklesIcon className={s.icon} />
    </span>
  );
}
