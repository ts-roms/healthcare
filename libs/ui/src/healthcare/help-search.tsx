"use client";

import * as React from "react";
import { SearchIcon, XIcon } from "lucide-react";
import type { LinkComponent } from "../layouts/link";
import { DefaultLink } from "../layouts/link";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { type ManualSection, searchManual } from "../primitives/manual-search";

/**
 * Search over the user manual: type a few words and the matching sections are listed with the chapter they are in
 * and a passage around the match; each result links to the section. The index is built on the server from the
 * Markdown files (`manualSections`) and searched here as the person types.
 */
export function HelpSearch({
  sections,
  linkComponent: Link = DefaultLink,
  placeholder = "Search the manual…",
  className,
  onNavigate,
}: {
  sections: ManualSection[];
  linkComponent?: LinkComponent;
  placeholder?: string;
  className?: string;
  /** Called when a result is chosen (close a dialog, clear the box). */
  onNavigate?: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const id = React.useId();
  const hits = React.useMemo(() => searchManual(sections, query), [sections, query]);
  const active = query.trim().length > 0;
  return (
    <div className={className}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          role="searchbox"
          aria-label="Search the manual"
          aria-controls={`${id}-results`}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 pr-9 pl-8"
        />
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      <div id={`${id}-results`} aria-live="polite">
        {active ? (
          hits.length === 0 ? (
            <p className="mt-2 text-table text-muted-foreground">Nothing in the manual matches “{query.trim()}”. Try other words.</p>
          ) : (
            <ol className="mt-2 flex flex-col divide-y rounded-lg border bg-card">
              {hits.map((hit) => (
                <li key={hit.href}>
                  <Link href={hit.href} className="block px-3 py-2 hover:bg-accent" onClick={onNavigate}>
                    <span className="block text-body font-medium text-primary">{hit.heading}</span>
                    {hit.chapter ? <span className="block text-meta text-muted-foreground">{hit.chapterTitle}</span> : null}
                    <span className="block text-table text-muted-foreground">{hit.snippet}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )
        ) : null}
      </div>
    </div>
  );
}
