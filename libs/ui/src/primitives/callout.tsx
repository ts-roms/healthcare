import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckCircle2Icon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "../lib/utils";

const callout = cva("flex items-start gap-3 rounded-xl border px-4 py-3 text-body", {
  variants: {
    tone: {
      info: "border-info/25 bg-info-subtle text-info-foreground",
      warning: "border-warning/40 bg-warning-subtle text-warning-foreground",
      danger: "border-danger/30 bg-danger-subtle text-danger-foreground",
      success: "border-success/30 bg-success-subtle text-success-foreground",
    },
  },
  defaultVariants: { tone: "info" },
});

const ICON = { info: InfoIcon, warning: TriangleAlertIcon, danger: OctagonAlertIcon, success: CheckCircle2Icon } as const;
const TONE_NAME = { info: "Information", warning: "Warning", danger: "Urgent", success: "Done" } as const;

/**
 * A message in the page: colour, an icon and the tone's name for screen readers (never colour alone). `danger` is announced
 * at once (`role="alert"`); the others politely (`role="status"`). Put the key fact in `title`, the rest in the body.
 */
function Callout({
  tone = "info",
  title,
  actions,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & VariantProps<typeof callout> & { title?: React.ReactNode; actions?: React.ReactNode }) {
  const t = tone ?? "info";
  const Icon = ICON[t];
  return (
    <div data-slot="callout" role={t === "danger" ? "alert" : "status"} className={cn(callout({ tone: t }), className)} {...props}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <span className="sr-only">{TONE_NAME[t]}: </span>
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5")}>{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { Callout };
