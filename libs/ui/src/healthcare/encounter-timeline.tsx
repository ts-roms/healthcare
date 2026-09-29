"use client";

import * as React from "react";
import type { Encounter } from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { clinicalDate } from "../lib/format";
import { cn } from "../lib/utils";

/** Compact encounter history (e.g. the "Patient History" column of the doctor workspace). */
export function EncounterTimeline({
  encounters,
  selectedId,
  onSelect,
  href,
  linkComponent = "a",
  className,
}: {
  encounters: Encounter[];
  selectedId?: string;
  onSelect?: (e: Encounter) => void;
  /** When given, each encounter is a link to this address instead of a button (e.g. the encounter workspace). */
  href?: (e: Encounter) => string | undefined;
  /** The link element for `href` (e.g. Next's Link); a plain anchor by default. */
  linkComponent?: React.ElementType;
  className?: string;
}) {
  const sorted = [...encounters].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ol className={cn("flex flex-col", className)}>
      {sorted.map((e) => (
        <li key={e.id}>
          <Item
            href={href?.(e)}
            linkComponent={linkComponent}
            onClick={() => onSelect?.(e)}
            current={e.id === selectedId}
            className={cn(
              "flex w-full flex-col gap-0.5 border-l-2 border-transparent px-2.5 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent",
              e.id === selectedId && "border-primary bg-primary-subtle",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className="tabular text-table font-semibold">{clinicalDate(e.date)}</span>
              <Badge variant="neutral" className="capitalize">
                {e.type}
              </Badge>
              {e.status === "unsigned" || e.status === "in-progress" ? <Badge variant="warning">{e.status === "unsigned" ? "Unsigned" : "Open"}</Badge> : null}
            </span>
            <span className="truncate text-table">{e.reason}</span>
            <span className="truncate text-meta text-muted-foreground">
              {e.provider} · {e.facility}
            </span>
          </Item>
        </li>
      ))}
    </ol>
  );
}

function Item({
  href,
  linkComponent: LinkComponent,
  onClick,
  current,
  className,
  children,
}: {
  href?: string;
  linkComponent: React.ElementType;
  onClick: () => void;
  current: boolean;
  className: string;
  children: React.ReactNode;
}) {
  if (href) {
    return (
      <LinkComponent href={href} aria-current={current ? "true" : undefined} className={className}>
        {children}
      </LinkComponent>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-current={current ? "true" : undefined} className={className}>
      {children}
    </button>
  );
}
