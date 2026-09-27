import type { LucideIcon } from "lucide-react";

/** An honest "nothing here yet" card: says why, and what the patient can do instead. */
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <div className="text-body text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
