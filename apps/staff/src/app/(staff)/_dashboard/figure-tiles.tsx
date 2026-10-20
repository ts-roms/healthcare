import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@healthcare/ui/lib/utils";

export interface FigureTile {
  key: string;
  label: string;
  value: string | number;
  /** Small unit after the value ("min"). */
  unit?: string;
  sub: string;
  href?: string;
  /** A tile that wants a look: red, with a warning icon. */
  alert?: boolean;
}

/** The day's figures in a row: appointments, who waits, the longest wait, who is with a provider and who has been seen. */
export function FigureTiles({ tiles }: { tiles: FigureTile[] }) {
  return (
    <section aria-label="Today in figures" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const body = (
          <>
            <p
              className={cn(
                "flex items-center gap-1 text-meta font-semibold tracking-wide uppercase",
                tile.alert ? "text-danger-foreground" : "text-muted-foreground",
              )}
            >
              {tile.alert ? <TriangleAlertIcon className="size-3.5" aria-hidden /> : null}
              {tile.label}
            </p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className={cn("tabular text-3xl font-semibold", tile.alert && "text-danger-foreground")}>{tile.value}</span>
              {tile.unit ? <span className={cn("text-body", tile.alert ? "text-danger-foreground" : "text-muted-foreground")}>{tile.unit}</span> : null}
            </p>
            <p className={cn("mt-0.5 truncate text-table", tile.alert ? "text-danger-foreground" : "text-muted-foreground")}>{tile.sub}</p>
          </>
        );
        const className = cn(
          "block min-w-0 rounded-xl border px-5 py-4 outline-none",
          tile.alert ? "border-danger/30 bg-danger-subtle" : "bg-card",
          tile.href && "hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50",
        );
        return tile.href ? (
          <Link key={tile.key} href={tile.href} className={className}>
            {body}
          </Link>
        ) : (
          <div key={tile.key} className={className}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
