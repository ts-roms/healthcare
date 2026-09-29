import Link from "next/link";
import * as React from "react";
import { Markdown } from "@healthcare/ui/primitives";
import { cn } from "@healthcare/ui/lib/utils";
import { manualHref } from "@/lib/manual";
import type { ManualChapter } from "@/lib/manual";

/** Chapter list beside one page of the manual. */
export function HelpShell({ chapters, active, source }: { chapters: ManualChapter[]; active: string | null; source: string }) {
  return (
    <div className="grid gap-6 p-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Manual chapters" className="lg:sticky lg:top-4 lg:self-start">
        <ol className="flex flex-wrap gap-1 text-table lg:flex-col">
          <li>
            <HelpLink href="/help" current={active === null}>
              Contents
            </HelpLink>
          </li>
          {chapters.map((chapter, i) => (
            <li key={chapter.slug}>
              <HelpLink href={`/help/${chapter.slug}`} current={active === chapter.slug}>
                <span className="tabular mr-1 text-muted-foreground">{i + 1}.</span>
                {chapter.title}
              </HelpLink>
            </li>
          ))}
        </ol>
      </nav>
      <article className="max-w-4xl min-w-0">
        <Markdown source={source} resolveHref={(href) => manualHref(href)} linkComponent={Link} />
      </article>
    </div>
  );
}

function HelpLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn("block rounded-md px-2 py-1 hover:bg-accent", current && "bg-primary-subtle font-semibold text-foreground")}
    >
      {children}
    </Link>
  );
}
